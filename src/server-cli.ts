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

const regex = new Map<string, RegExp>();

rl.on('line', l => {

  if (regex.size < 1) {
    process.stdout.write(l + '\n');
    return;
  }

  for (let [k, v] of regex) {
    if (v.test(l)) {
      process.stdout.write(chalk.magenta(' (filtered) ') + l + '\n');
      break;
    }
  }

});

interface IncomingTCPMessage {
  command: {
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
        sendMessage(true, {regexes: Array.from(regex.keys()).map(k => ({regex: regex.get(k), str: k}))}, cb);
      });
    }

    if (c.removeall) {
      return q.push(cb => {
        log.info('Clearing all regex.');
        regex.clear();
        sendMessage(true, `Cleared all regex.`, cb);
      });
    }

    if (c.add) {
      return q.push(cb => {
        log.info('Adding regex:', c.add);
        regex.set(c.add, new RegExp(c.add));
        sendMessage(true, `Added regex: ${c.add}`, cb);
      });
    }

    if (c.remove) {
      return q.push(cb => {
        regex.delete(c.remove);
        sendMessage(true, `Deleted regex: ${c.remove}.`, cb);
        log.info('Removed regex:', c.remove);
      });
    }

    log.error('No matching field was found:', d);
    log.info('Regex:', regex);
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
