'use strict';

import chalk from "chalk";
const isDebug = process.env.dygrep_is_debug === 'yes';

export const log = {
  info: console.log.bind(console, chalk.gray('dygrep info:')),
  warning: console.error.bind(console, chalk.bold.yellow.bold('dygrep warn:')),
  warn: console.error.bind(console, chalk.bold.magenta.bold('dygrep warn:')),
  error: console.error.bind(console, chalk.redBright.bold('dygrep error:')),
  debug: function (...args: any[]) {
    isDebug && console.log('dygrep debug:', ...args);
  }
};

export default log;

