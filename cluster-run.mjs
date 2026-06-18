import cluster from 'node:cluster';
const N = Number(process.env.CLUSTER_WORKERS || 8);
if (cluster.isPrimary) {
  console.log(`cluster primary ${process.pid} forking ${N} workers`);
  for (let i = 0; i < N; i++) cluster.fork();
  cluster.on('exit', (w, code) => console.log(`worker ${w.process.pid} exited code=${code}`));
} else {
  await import('./dist/src/server.js');
}
