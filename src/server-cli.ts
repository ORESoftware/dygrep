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

process.on('unhandledRejection', (r, d) => {
  const v = r.message || r;
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

server.listen(port);

const onSignal = (signal: string) => {

  log.warn('services-manager received signal:', signal);

  const to = setTimeout(() => {
    log.warn('Server close call timed out.');
    process.exit(1);
  }, 500);

  server.close((err: any) => {
    clearTimeout(to);
    if (err) {
      log.warn(err);
      process.exit(1);
    }
    else {
      process.exit(0);
    }
  });

};

process.once('SIGTERM', onSignal);
process.once('SIGINT', onSignal);

process.once('exit', code => {

  log.warn('Dygrep server is exiting with code:', code);

  server.close();

  for (let v of connections) {
    v.destroy();
  }

});
