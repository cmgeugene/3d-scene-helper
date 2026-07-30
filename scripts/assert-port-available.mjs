import net from 'node:net';

const host = process.argv[2];
const port = Number.parseInt(process.argv[3] ?? '', 10);

if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('Usage: node scripts/assert-port-available.mjs <host> <port>');
  process.exit(2);
}

const server = net.createServer();

server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Preview port ${host}:${port} is already in use; refusing to reuse an existing server.`,
    );
  } else {
    console.error(
      `Could not verify preview port ${host}:${port}: ${error.message}`,
    );
  }

  process.exit(1);
});

server.listen({ host, port, exclusive: true }, () => {
  server.close((error) => {
    if (error) {
      console.error(
        `Could not release preview port ${host}:${port}: ${error.message}`,
      );
      process.exit(1);
    }
  });
});
