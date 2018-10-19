#!/usr/bin/env node
'use strict';

//core
import * as util from 'util';
import * as assert from 'assert';
import * as readline from 'readline';
import * as net from 'net';
import chalk from 'chalk';
import {JSONParser} from "@oresoftware/json-stream-parser";
import log from './logger';
import * as safe from '@oresoftware/safe-stringify';

const portIndex = process.argv.indexOf('-p');
let port = 4900;

if (portIndex > 1) {
  port = parseInt(process.argv[portIndex + 1]);
}

if (!Number.isInteger(port)) {
  throw chalk.magenta('Please pass a port that can be parsed to an integer as the argument following -p.')
}

const acceptableCommands = {
  'add:': true,
  'list': true,
  'removeall': true,
  'remove:': true,
  'search:': true,
  'regex:': true,
  'clear': true,
  'help': true,
  'exit': true
};

const prompt = chalk.blueBright(`(localhost:${port})`) + chalk.blueBright.bold(` dygrep > `);

let resetCurrentLine = () => {
  readline.clearLine(process.stdout, 0);  // clear current text
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(prompt);
};

let onBackspace = () => {
  readline.clearLine(process.stdout, 0);  // clear current text
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(prompt + currentLine);
};

process.on('uncaughtException', e => {
  const v = e.message || e;
  log.error('uncaught exception:', chalk.magenta(typeof v === 'string' ? v : util.inspect(v)));
  resetCurrentLine();
});

process.on('unhandledRejection', (r, d) => {
  const v = r.message || r;
  log.error('unhandled rejection:', chalk.magenta(typeof v === 'string' ? v : util.inspect(v)));
  resetCurrentLine();
});

const container = {
  conn: null as net.Socket
};

type Cmds = { [index: string]: number };
const cmds: Cmds = Object.keys(acceptableCommands).reduce((a, b) => (a[b] = b.length, a), {} as Cmds);

let currentLine = '', previousCmd = '', commands: Array<string> = [];

const onUserHitReturn = (d: string) => {

  const s = container.conn;

  readline.clearLine(process.stdout, 0);  // clear current text
  readline.cursorTo(process.stdout, 0);   // move cursor to beginning of line

  const lc = String(d || '').trim().toLowerCase();

  if (!lc) {
    process.stdout.write(prompt);
    return;
  }

  if (lc === 'clear') {
    process.stdout.write('\x1Bc');
    process.stdout.write(prompt);
    return;
  }

  if (lc === 'help') {
    console.log(chalk.bold('Available commands:'));
    console.log(Object.keys(acceptableCommands));
    process.stdout.write(prompt);
    return;
  }

  {
    // regex
    let c = 'regex:';
    if (lc.startsWith(c)) {
      let ln = cmds[c];
      log.debug(chalk.gray('sending message to server:'), chalk.bold(lc));
      s.write(safe.stringify({command: {[lc.split(':')[0]]: lc.slice(ln)}}) + '\n');
      return;
    }
  }

  {
    // search
    let c = 'search:';
    if (lc.startsWith(c)) {
      let ln = cmds[c];
      log.debug(chalk.gray('sending message to server:'), chalk.bold(lc));
      s.write(safe.stringify({command: {[lc.split(':')[0]]: lc.slice(ln)}}) + '\n');
      return;
    }
  }

  if (lc === 'removeall') {
    log.debug('sending message to server:', lc);
    s.write(safe.stringify({command: {removeall: true}}) + '\n');
    return;
  }

  if (lc === 'list') {
    log.debug('sending message to server:', lc);
    s.write(safe.stringify({command: {list: true}}) + '\n');
    return;
  }

  if (lc.startsWith('add:')) {
    log.debug('sending message to server:', lc);
    s.write(safe.stringify({command: {add: lc.slice(4)}}) + '\n');
    return;
  }

  if (lc.startsWith('remove:')) {
    log.debug('sending message to server:', lc);
    s.write(safe.stringify({command: {remove: lc.slice(7)}}) + '\n');
    return;
  }

  console.log('Command not recognized:', lc);
  console.log('Try using "help" to view available commands.');
  process.stdout.write(prompt);

};

process.stdin.setRawMode(true);
process.stdin.on('data', buf => {

  const s = container.conn;
  const str = String(buf);
  const charAsAscii = String(buf.toString().charCodeAt(0));

  if (!['3', '4'].includes(charAsAscii)) {
    // if we are not using ctrl-c or ctrl-d, then ignore other commands
    if (!(s && s.writable)) {
      log.warn('We are not (yet) connected to the dygrep server.');
      return;
    }
  }

  if (buf == '\u001B\u005B\u0043') {
    // left arrow key
    return;
  }

  if (buf == '\u001B\u005B\u0044') {
    // right arrow key
    return;
  }

  if (buf == '\u001B\u005B\u0041') {
    // up arrow key
    previousCmd = commands.pop() || '';
    if (previousCmd && (commands[0] !== previousCmd)) {
      // we only unshift if it's not the same as the element already there
      commands.unshift(previousCmd);
    }
    resetCurrentLine();
    currentLine = previousCmd;
    process.stdout.write(previousCmd);
    return;
  }

  if (buf == '\u001B\u005B\u0042') {
    // down arrow key
    previousCmd = commands.shift() || '';
    if (previousCmd && commands[commands.length - 1] !== previousCmd) {
      // we only push if the it's not the same as the element already there
      commands.push(previousCmd);
    }
    resetCurrentLine();
    currentLine = previousCmd;
    process.stdout.write(previousCmd);
    return;
  }


  switch (charAsAscii) {

    case '9': // tab

      let matches = Object.keys(acceptableCommands).filter(v => String(v).startsWith(currentLine));

      if (matches.length !== 1) {
        process.stdout.write('\n');
        console.log(matches);
        process.stdout.write(prompt + currentLine);
        return;
      }

      resetCurrentLine();
      currentLine = matches[0] || '';
      process.stdout.write(currentLine);
      break;

    case '3':
      console.log('\nYou pressed Ctrl-C. Sending SIGINT.');
      process.kill(process.pid, 'SIGINT');
      break;

    case '4':
      console.log('\nYou pressed Ctrl-D. Bye!');
      process.exit(0);
      break;

    case '12':
      process.stdout.write('\x1Bc');
      process.stdout.write(prompt);
      break;

    case '13': // enter/return
      process.stdout.write('\n');
      currentLine && commands.push(currentLine);
      onUserHitReturn(currentLine || '');
      currentLine = '';
      break;

    case '27':
      previousCmd = commands.pop() || '';
      currentLine = previousCmd;
      resetCurrentLine();
      process.stdout.write(previousCmd);
      break;

    case '127':
      currentLine = currentLine.slice(0, -1);
      onBackspace();
      break;

    default:
      process.stdout.write(str);
      currentLine += str || '';
      break;
  }
});

const handleConnection = (s: net.Socket): net.Socket => {

  s.pipe(new JSONParser()).on('data', (d: any) => {

    log.info(chalk.green.underline('dygrep server response:'));

    if (d && d.message) {

      if (d.message.lines) {
        const lines = d.message.lines;
        for (let v of lines) {
          console.log(v);
        }
        console.log('_____________________________________________________________')
        console.log(`Overall: ${chalk.bold(lines.length)} lines matched your query.`)
      }
      else {
        log.info(d.message);
      }

    }

    if (d && d.lastMessage) {
      process.stdout.write(prompt);
    }

  });

  s.once('connect', () => {
    console.log(chalk.green('dygrep client is connected to server at port:'), chalk.green.bold(String(port)));
    process.stdout.write(prompt);
  });

  return s;

};

const getConnection = () => {

  const s = container.conn = net.createConnection({port}).setEncoding('utf8');

  const reconnect = () => {

    s.removeAllListeners();
    s.destroy();

    readline.clearLine(process.stdout, 0);  // clear current text
    readline.cursorTo(process.stdout, 0);

    log.warn('socket disconnected, will try to reconnect in 5 seconds...');

    setTimeout(() => {

      const to = setTimeout(() => {
        log.warn('dygrep socket could not re-connect, so we will exit.');
        process.exit(1);
      }, 1000);

      handleConnection(getConnection()).once('connect', () => {
        clearTimeout(to);
        log.info('socket reconnected.');
        process.stdout.write(prompt);
      });

    }, 5000);

  };

  s.once('error', e => {
    log.error(chalk.redBright('socket experienced an error:'), util.inspect(e.message || e, {breakLength: Infinity}));
    reconnect();
  });

  s.once('end', () => {
    reconnect();
  });

  return s;

};

handleConnection(
  getConnection()
);









