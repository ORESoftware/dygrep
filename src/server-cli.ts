#!/usr/bin/env node
'use strict';


import * as readline from 'readline';
import * as net from 'net';
import chalk from 'chalk';
import {createParser} from "./json-parser";
import log from './logger';


const portIndex = process.argv.indexOf('-p');
let port = 4900;

if(portIndex > 1){
  port = parseInt(process.argv[portIndex + 1]);
}

if(!Number.isInteger(port)){
  throw chalk.magenta('Please pass a port that can be parsed to an integer as the argument following -p.')
}


const rl = readline.createInterface({
  input: process.stdin.resume()
});

const regex = new Map<string, RegExp>();

rl.on('line', l => {

  let hasKeys = false;

  for(let [k,v] of regex){
    hasKeys = true;
    if(v.test(l)){
      process.stdout.write(l + '\n');
      break;
    }
  }

  if(!hasKeys){
    process.stdout.write(l + '\n');
  }
});

interface IncomingTCPMessage {
  command: {
    add: string,
    remove: string
  }
}



const server = net.createServer(s => {

  s.on('data', d => {
    console.log('received raw data:', String(d));
  });

  s.pipe(createParser()).on('data', (d: IncomingTCPMessage) => {

    console.log('recieved JSON data:', d);

    if(!d.command){
      log.error('No "command" field was found:', d);
      return''
    }

    const c = d.command;

    if(c.add){
      regex.set(c.add, new RegExp(c.add));
      s.write(`Added regex: ${c.add}.\n`);
      log.info('Added regex:', c.add);
      return;
    }

    if(c.remove){
      regex.delete(c.remove);
      s.write(`Deleted regex: ${c.remove}.\n`);
      log.info('Removed regex:', c.remove);
      return;
    }


    log.error('No matching field was found:', d);
    log.info('Regex:', regex);

  });

});

server.listen(port);

