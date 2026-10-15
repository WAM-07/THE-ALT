// The local chain `npm run demo` runs (see journal.mjs). It only differs from Hardhat's default
// in starting on a chosen date, so a saved demo chain can be replayed at its original times.
export default {
  networks: {
    node: {
      type: 'edr-simulated',
      ...(process.env.ALT_CHAIN_INITIAL_DATE ? { initialDate: new Date(Number(process.env.ALT_CHAIN_INITIAL_DATE) * 1000) } : {}),
    },
  },
};
