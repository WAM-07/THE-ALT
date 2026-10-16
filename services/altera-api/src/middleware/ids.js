/**
 * Route ids are UUIDs. A malformed one (e.g. "/posts/undefined/react") gets a clear 400 here,
 * instead of reaching the database and coming back as a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParams(router, ...names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => (UUID.test(value) ? next() : res.status(400).json({ code: 'BAD_ID', message: `That ${name} is not a valid id.` })));
  }
}

module.exports = { UUID, uuidParams };
