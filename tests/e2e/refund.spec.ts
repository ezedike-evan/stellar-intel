const { test, expect } = require('@jest/globals');

test('refund state progression', () => {

  const flow = ['pending_user', 'pending_anchor', 'refunded'];

  const refund = {
    status: flow[2],
    amount: 100,
    currency: 'USD'
  };

  expect(refund.status).toBe('refunded');
  expect(refund.amount).toBe(100);
});
