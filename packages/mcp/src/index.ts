#!/usr/bin/env node
import { startStdioServer } from './transports/stdio.js';
import { startStreamableHttpServer } from './transports/streamable-http.js';

interface CliOptions {
  transport: 'stdio' | 'http';
  host: string;
  port: number;
}

const USAGE = `Usage: @stellarintel/mcp [options]

Options:
  --transport <stdio|http>  Transport to serve over (default: stdio)
  --host <host>             Host to bind for --transport=http (default: 127.0.0.1)
  --port <port>             Port to bind for --transport=http (default: 3000)
  -h, --help                Show this help
`;

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = {
    transport: 'stdio',
    host: '127.0.0.1',
    port: 3000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    const [flag, inlineValue] = arg.split('=');
    const value = inlineValue ?? argv[++i];

    switch (flag) {
      case '--transport':
        if (value === undefined) {
          process.stderr.write(`Missing value for "--transport".\n\n${USAGE}`);
          return null;
        }
        if (value === 'stdio' || value === 'http') {
          options.transport = value;
        } else {
          process.stderr.write(
            `Unknown transport "${value}". Expected "stdio" or "http".\n\n${USAGE}`
          );
          return null;
        }
        break;
      case '--host':
        if (value === undefined) {
          process.stderr.write(`Missing value for "--host".\n\n${USAGE}`);
          return null;
        }
        options.host = value;
        break;
      case '--port': {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
          options.port = parsed;
        } else {
          process.stderr.write(`Invalid port "${value}".\n\n${USAGE}`);
          return null;
        }
        break;
      }
      case '-h':
      case '--help':
        process.stdout.write(USAGE);
        return null;
      default:
        process.stderr.write(`Unknown option "${flag}".\n\n${USAGE}`);
        return null;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    process.exit(1);
  }

  if (options.transport === 'http') {
    const handle = await startStreamableHttpServer({ host: options.host, port: options.port });
    process.stderr.write(`MCP server listening on ${handle.url} (streamable HTTP)\n`);
  } else {
    await startStdioServer();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
