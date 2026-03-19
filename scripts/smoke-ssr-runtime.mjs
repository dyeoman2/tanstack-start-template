const serverEntryUrl = new URL('../dist/server/server.js', import.meta.url);

try {
  await import(serverEntryUrl.href);
  console.log('SSR smoke check passed: server bundle imports in Node');
} catch (error) {
  console.error('SSR smoke check failed: server bundle crashed during Node import');
  console.error(error);
  process.exit(1);
}
