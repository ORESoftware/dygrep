#!/usr/bin/env node
'use strict';

import * as readline from 'readline';
import * as net from 'net';
import chalk from 'chalk';
import {createParser} from "./json-parser";
import log from './logger';

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

const server = net.createServer(s => {

  s.on('data', d => {
    console.log('received raw data:', String(d));
  });

  const sendMessage = (m: any) => {
    s.write(JSON.stringify({message: m}) + `\n`);
  };

  s.pipe(createParser()).on('data', (d: IncomingTCPMessage) => {

    console.log('recieved JSON data:', d);

    if (!d.command) {
      log.error('No "command" field was found:', d);
      return ''
    }

    const c = d.command;

    if (c.list) {
      sendMessage({regexes: Array.from(regex.keys()).map(k => ({regex: regex.get(k), str: k}))});
      log.info('Listing all regex for the client.');
      return;
    }

    if (c.removeall) {
      regex.clear();
      sendMessage(`Cleared all regex.`);
      log.info('Cleared all regex.');
      return;
    }

    if (c.add) {
      regex.set(c.add, new RegExp(c.add));
      sendMessage(`Added regex: ${c.add}.`);
      log.info('Added regex:', c.add);
      return;
    }

    if (c.remove) {
      regex.delete(c.remove);
      sendMessage(`Deleted regex: ${c.remove}.`);
      log.info('Removed regex:', c.remove);
      return;
    }

    log.error('No matching field was found:', d);
    log.info('Regex:', regex);

  });

});

server.listen(port);

