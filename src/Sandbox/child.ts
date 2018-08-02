import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { NodeVM } from 'vm2';

import { IMessage } from '../models/sandbox.interface';
import { getDebug } from '../utils';

const debug = getDebug('sandbox');

const send = (msg: IMessage) => {
  debug(`Sending parent message: ${JSON.stringify(msg)}`);

  if (process.send) {
    return process.send(msg);
  }

  throw new Error('Not running in a child process, closing');
};

const buildBrowserSandbox = (page: puppeteer.Page): { console: any } => {
  debug(`Generating sandbox console`);

  return {
    console: _.reduce(_.keys(console), (browserConsole, consoleMethod) => {
      browserConsole[consoleMethod] = (...args) => {
        args.unshift(consoleMethod);
        return page.evaluate((...args) => {
          const [consoleMethod, ...consoleArgs] = args;
          return console[consoleMethod](...consoleArgs);
        }, ...args);
      };

      return browserConsole;
    }, {}),
  };
};

const start = async (
  { code, flags = [], useChromeStable }:
  { code: string; flags: string[], useChromeStable: boolean },
) => {
  debug(`Starting sandbox running code "${code}"`);
  const launchArgs: puppeteer.LaunchOptions = {
    args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
  };

  if (useChromeStable) {
    launchArgs.executablePath = '/usr/bin/google-chrome';
  }

  debug(`Starting Chrome with args: ${JSON.stringify(launchArgs)}`);

  const browser = await puppeteer.launch(launchArgs);
  const browserWsEndpoint = browser.wsEndpoint();
  const page: any = await browser.newPage();
  page.on('error', (error) => {
    debug(`Page error: ${error.message}`);
    send({
      error,
      event: 'error',
    });
  });
  const pageLocation = `/devtools/page/${page._target._targetId}`;
  const port = url.parse(browserWsEndpoint).port;
  const data = {
    context: {
      port,
      url: pageLocation,
    },
    event: 'launched',
  };

  debug(`Browser launched on port ${port}`);

  send(data);

  const sandbox = buildBrowserSandbox(page);
  const vm: any = new NodeVM({ sandbox });
  const handler = vm.run(code);

  await handler({ page, context: {} });
};

process.on('message', (message) => {
  const { event } = message;

  if (event === 'start') {
    return start(message.context);
  }

  return;
});
