import https from 'node:https';
export default {
  async fetch() {
    const results = [];
    // Fixed non-credentialed destinations only; never accepts a caller-supplied target.
    for (const target of ['https://example.com', 'https://127.0.0.1', 'https://[::1]']) {
      try {
        const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        results.push({ target, status: response.status });
        await response.body?.cancel();
      } catch (error) { results.push({ target, error: error.message }); }
    }
    const lookup = await new Promise(resolve => {
      https.get('https://example.com', {
        lookup(_host, _options, callback) { callback(new Error('policy-denied')); },
      }, response => { response.resume(); resolve({ status: response.statusCode }); })
        .on('error', error => resolve({ error: error.message }));
    }).catch(error => ({ error: error.message }));
    return Response.json({ results, lookup });
  },
};
