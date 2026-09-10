import assert from 'node:assert/strict';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// This scratch classifier covers the experiment; the product transport needs its full policy.
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]]) denied.addSubnet(address,prefix,'ipv6');
function publicAddress(address) {
  const family = isIP(address);
  return family && !denied.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
async function request(resolve) {
  let lookups = 0, selected, peer;
  const status = await new Promise((accept, reject) => {
    const req = https.get('https://example.com', {
      agent: false,
      signal: AbortSignal.timeout(10000),
      lookup(host, options, callback) {
        lookups++;
        resolve(host).then(addresses => {
          if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
            callback(new Error('non-public-destination')); return;
          }
          selected = addresses[0];
          // Return exactly one checked address. TLS still authenticates example.com.
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        }, callback);
      },
    }, response => { response.resume(); accept(response.statusCode); });
    req.on('socket', socket => socket.once('secureConnect', () => {
      peer = { address: socket.remoteAddress, authenticated: socket.authorized };
    }));
    req.on('error', reject);
  });
  return {status, lookups, selected, peer};
}
const addresses = await lookup('example.com', { all: true, family: 4 });
let resolverCalls = 0;
const result = await request(async () => ++resolverCalls === 1 ? addresses : [{address:'127.0.0.1',family:4}]);
assert.equal(result.status,200);
assert.equal(result.lookups,1);
assert.equal(resolverCalls,1);
assert.equal(result.peer.authenticated,true);
assert.equal(result.peer.address,result.selected.address);
for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1']) {
  await assert.rejects(request(async () => [{address,family:isIP(address)}]), /non-public-destination/);
}
console.log(JSON.stringify({runtime:process.version,publicTls:result,privateDestinationsRejected:5}));
