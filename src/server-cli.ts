#!/usr/bin/env node
'use strict';

import * as readline from 'readline';
import * as net from 'net';
import chalk from 'chalk';
import {JSONParser} from "@oresoftware/json-stream-parser";
import log from './logger';
import {EVCb} from "./index";
import * as async from 'async';
import * as util from "util";


process.on('uncaughtException', e => {
  const v = e.message || e;
  log.error('uncaught exception:', chalk.magenta(typeof v === 'string' ? v : util.inspect(v)));
});

process.on('unhandledRejection', (r: any) => {
  const v = r && (r.message || r);
  log.error('unhandled rejection:', chalk.magenta(typeof v === 'string' ? v : util.inspect(v)));
});

const portIndex = process.argv.indexOf('-p');
let port = 4900;

if (portIndex > 1) {
  port = parseInt(process.argv[portIndex + 1]);
}

if (!Number.isInteger(port)) {
  throw chalk.magenta('Please pass a port that can be parsed to an integer as the argument following -p.')
}

const rl = readline.createInterface({
  input: process.stdin.resume()
});

const container = {
  debug: false,
  lines: <Array<string>>[],
  regex: new Map<string, RegExp>()
};

rl.on('line', l => {

  container.lines.push(l);

  if (container.lines.length > 99000) {
    container.lines.shift();
  }

  if (container.regex.size < 1) {
    process.stdout.write(l + '\n');
    return;
  }

  for (let [k, v] of container.regex) {
    if (v.test(l)) {
      process.stdout.write(chalk.magenta(' (filtered) ') + l + '\n');
      break;
    }
  }

});

interface IncomingTCPMessage {
  command: {
    regex: string,
    clear: boolean,
    search: string
    add: string,
    remove: string,
    list: boolean,
    removeall: boolean
  }
}

export type Task = (cb: EVCb<any>) => void;

const joinMessages = (...args: string[]) => {
  return args.join(' ');
};

const connections = new Set<net.Socket>();
const q = async.queue<Task, any>((task, cb) => task(cb), 1);

q.error = e => {
  if (e) {
    log.error(e.message || e);
    for (let c of connections) {
      c.write(JSON.stringify({message: util.inspect(e.message || e), lastMessage: true}) + `\n`);
    }
  }
};

const server = net.createServer(s => {

  connections.add(s);
  s.once('close', () => connections.delete(s));

  s.on('error', err => {
    log.warn(err.message || err);
  });

  s.on('data', d => {
    log.debug('dygrep received raw data:', String(d));
  });

  const sendMessage = (lastMessage: boolean, m: any, cb: EVCb<any>) => {
    s.write(JSON.stringify({message: m, lastMessage}) + `\n`, cb);
  };

  s.pipe(new JSONParser()).on('data', (d: IncomingTCPMessage) => {

    log.debug('dygrep recieved JSON data:', d);

    if (!d.command) {
      log.error('No "command" field was found:', d);
      return ''
    }

    const c = d.command;

    if (c.list) {
      return q.push(cb => {
        log.info('Listing all regex for the client.');
        const regex = container.regex;
        const regexes = Array.from(regex.keys()).map(k => ({regex: regex.get(k), str: k}));
        sendMessage(true, {regexes}, cb);
      });
    }

    if (c.removeall || c.clear) {
      return q.push(cb => {
        log.info('Clearing all regex.');
        container.regex.clear();
        sendMessage(true, `Cleared all regex.`, cb);
      });
    }

    if (c.search) {
      return q.push(cb => {
        const searchTerm = String(c.search || '').trim();
        log.info('searching for:', searchTerm);
        container.debug && log.info('Searching lines for:', searchTerm);
        const matching = container.lines.filter(v => {
          return String(v || '').toLowerCase().match(searchTerm);
        });
        sendMessage(true, {lines: matching}, cb);
      });
    }

    if (c.regex) {
      return q.push(cb => {
        const regex = new RegExp(c.regex);
        container.debug && log.info('Getting all matching lines by regex:', regex);
        const matching = container.lines.filter(v => {
          return regex.test(String(v || '').toLowerCase());
        });
        sendMessage(true, {lines: matching}, cb);
      });
    }

    if (c.add) {
      return q.push(cb => {
        container.debug && log.info('Adding regex:', c.add);
        container.regex.set(c.add, new RegExp(c.add));
        sendMessage(true, `Added regex: ${c.add}`, cb);
      });
    }

    if (c.remove) {
      return q.push(cb => {
        container.regex.delete(c.remove);
        sendMessage(true, `Deleted regex: ${c.remove}.`, cb);
        log.info('Removed regex:', c.remove);
      });
    }

    log.error('No matching field was found:', d);
    log.debug('Current regex:', container.regex);
    sendMessage(true, 'Your request could not be processed.', null);

  });

});

type ShutdownPhase = 'running' | 'draining' | 'forcing' | 'stopped';
type ShutdownLevel = 'info' | 'warn' | 'error';

const stdinIsTTY = Boolean(process.stdin.isTTY);
const DEFAULT_GRACE_MS = 5000;
const MAX_GRACE_MS = 60 * 60 * 1000;
const configuredGraceMs = parseInt(process.env.SHUTDOWN_GRACE_MS || '', 10);
const graceMs = Number.isSafeInteger(configuredGraceMs) && configuredGraceMs > 0 && configuredGraceMs <= MAX_GRACE_MS
  ? configuredGraceMs
  : DEFAULT_GRACE_MS;

let shutdownPhase: ShutdownPhase = 'running';
let shutdownStartedAt: number | null = null;
let firstShutdownTrigger = '';
let signalCount = 0;
let graceTimer: any = null;
let forceSettleTimer: any = null;
let forcedBy = '';
let finished = false;
let readlineClosed = false;
let ctrlDArmed = false;

const shutdownLog = (
  level: ShutdownLevel,
  event: string,
  message: string,
  fields: {[key: string]: any} = {}
) => {
  const record = JSON.stringify(Object.assign({
    event,
    message,
    phase: shutdownPhase,
    tty: stdinIsTTY,
    signal_count: signalCount,
    grace_ms: graceMs,
    active_connections: connections.size,
    elapsed_ms: shutdownStartedAt === null ? 0 : Date.now() - shutdownStartedAt
  }, fields));

  if (level === 'error') {
    log.error(record);
  }
  else if (level === 'warn') {
    log.warn(record);
  }
  else {
    log.info(record);
  }
};

const finishShutdown = (outcome: 'graceful' | 'forced', trigger: string, exitCode: number) => {
  if (finished) {
    return;
  }
  finished = true;
  ctrlDArmed = false;
  shutdownPhase = 'stopped';
  clearTimeout(graceTimer);
  clearTimeout(forceSettleTimer);
  shutdownLog(exitCode === 0 ? 'info' : 'error', 'server.shutdown.complete', 'Dygrep server shutdown complete', {
    outcome,
    trigger,
    first_trigger: firstShutdownTrigger,
    exit_code: exitCode
  });
  process.exitCode = exitCode;
  rl.close();
  process.stdin.pause();
};

const forceShutdown = (reason: string) => {
  if (shutdownPhase !== 'draining') {
    return;
  }
  shutdownPhase = 'forcing';
  forcedBy = reason;
  ctrlDArmed = false;
  clearTimeout(graceTimer);
  shutdownLog('warn', 'server.shutdown.force', 'Forcing shutdown; active TCP connections will be dropped', {
    forced_by: reason,
    first_trigger: firstShutdownTrigger
  });

  if (typeof (q as any).kill === 'function') {
    (q as any).kill();
  }
  for (let socket of connections) {
    socket.destroy();
  }

  // server.close normally settles once destroyed sockets are gone. Keep a
  // bounded fallback so a broken socket/listener implementation cannot pin the
  // process indefinitely after an explicit force/deadline transition.
  forceSettleTimer = setTimeout(() => {
    const exitCode = reason === 'stdin_eof' ? 0 : 1;
    finishShutdown('forced', reason, exitCode);
  }, 1000);
};

const startGracefulShutdown = (trigger: string) => {
  if (shutdownPhase !== 'running') {
    return;
  }

  shutdownPhase = 'draining';
  shutdownStartedAt = Date.now();
  firstShutdownTrigger = trigger;
  signalCount = 1;
  shutdownLog('info', 'server.shutdown.requested', 'Listener is closing and active TCP connections are draining', {
    trigger
  });

  if (stdinIsTTY && trigger === 'SIGINT') {
    if (readlineClosed) {
      shutdownLog('warn', 'server.shutdown.interactive_unavailable', 'stdin is already closed; waiting for graceful deadline instead of advertising Ctrl-D force', {
        trigger
      });
    }
    else {
      ctrlDArmed = true;
      shutdownLog('info', 'server.shutdown.interactive', 'Use Ctrl-D to force shutdown; repeated Ctrl-C does not bypass the grace window', {
        trigger
      });
    }
  }

  graceTimer = setTimeout(() => forceShutdown('deadline'), graceMs);
  server.close((err?: Error) => {
    if (err) {
      shutdownLog('error', 'server.shutdown.listener_error', 'TCP listener failed while closing', {
        error: err.message || String(err)
      });
      if (shutdownPhase === 'draining') {
        forceShutdown('listener_error');
        return;
      }
    }

    const forced = shutdownPhase === 'forcing';
    finishShutdown(forced ? 'forced' : 'graceful', forced ? forcedBy : trigger, err ? 1 : 0);
  });
};

const onSignal = (signal: string) => {
  if (shutdownPhase === 'running') {
    startGracefulShutdown(signal);
    return;
  }

  if (shutdownPhase === 'draining') {
    signalCount += 1;
    shutdownLog('info', 'server.shutdown.signal_ignored', 'Shutdown is already draining; repeated signals do not force termination', {
      signal
    });
  }
};

server.on('error', err => {
  shutdownLog('error', 'server.error', 'Dygrep TCP server error', {
    error: err.message || String(err)
  });
  if (shutdownPhase === 'running') {
    process.exitCode = 1;
  }
});

server.listen(port, () => {
  log.info(`Dygrep server listening on port ${port}.`);
});

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

// Ctrl-D is an explicit force action only after an interactive SIGINT has
// started the graceful drain. EOF before that point closes readline but does
// not shut down the TCP server or silently become future force intent.
rl.on('close', () => {
  readlineClosed = true;
  if (ctrlDArmed && stdinIsTTY && shutdownPhase === 'draining' && firstShutdownTrigger === 'SIGINT') {
    forceShutdown('stdin_eof');
  }
});

process.once('exit', code => {
  log.warn('Dygrep server is exiting with code:', code);
  for (let socket of connections) {
    socket.destroy();
  }
});
