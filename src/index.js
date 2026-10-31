const GREETING = 'Hello World';

const PLAIN_TEXT_HEADERS = {
  'content-type': 'text/plain;charset=UTF-8',
};

/**
 * Logs a greeting and returns it as the response body.
 *
 * @returns {Promise<Response>}
 */
async function handleRequest() {
  console.log(GREETING);

  return new Response(GREETING, {
    status: 200,
    headers: PLAIN_TEXT_HEADERS,
  });
}

export default {
  fetch: handleRequest,
};
