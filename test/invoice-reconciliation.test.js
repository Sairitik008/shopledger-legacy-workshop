const test = require('node:test');
const assert = require('node:assert/strict');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function billedItems() {
  return [
    {
      id: 1,
      sku: 'GRN-001',
      name: 'Indrayani Basmati Rice 5kg',
      hsn: '1006',
      price: 640,
      qty: 1
    },
    {
      id: 4,
      sku: 'OIL-001',
      name: 'Cold-Pressed Sunflower Oil 1L',
      hsn: '1512',
      price: 190,
      qty: 2
    }
  ];
}

function billedOrder(overrides) {
  return Object.assign({
    id: 1002,
    date: '05/01/2022',
    customer: 'Anil Kulkarni',
    customerId: 2,
    paymentMode: 'upi',
    status: 'completed',
    items: billedItems(),
    coupon: 'SAVE10',
    subtotal: 1020,
    discount: 102,
    tax: 45.9,
    total: 963.9
  }, overrides || {});
}

test('CURRENT BEHAVIOUR: pricing applies SAVE10 before HSN GST calculation', () => {
  const totals = pricing.computeTotals(billedItems(), 'SAVE10');

  assert.equal(totals.subtotal, 1020);
  assert.equal(totals.discount, 102);
  assert.equal(totals.taxable, 918);
  assert.equal(totals.tax, 45.9);
  assert.equal(totals.cgst, 22.95);
  assert.equal(totals.sgst, 22.95);
  assert.equal(totals.total, 963.9);
  assert.deepEqual(totals.lines.map((line) => ({
    hsn: line.hsn,
    gstPercent: line.gstPercent,
    discount: line.discount,
    taxable: line.taxable,
    tax: line.tax
  })), [
    { hsn: '1006', gstPercent: 5, discount: 64, taxable: 576, tax: 28.8 },
    { hsn: '1512', gstPercent: 5, discount: 38, taxable: 342, tax: 17.1 }
  ]);
});

test('invoice figures match the totals used when the customer was billed', () => {
  const billedTotals = pricing.computeTotals(billedItems(), 'SAVE10');
  const invoiceFigures = invoice.computeInvoiceFigures(billedOrder());

  assert.equal(invoiceFigures.subtotal, billedTotals.subtotal);
  assert.equal(invoiceFigures.discount, billedTotals.discount);
  assert.equal(invoiceFigures.tax, billedTotals.tax);
  assert.equal(invoiceFigures.cgst, billedTotals.cgst);
  assert.equal(invoiceFigures.sgst, billedTotals.sgst);
  assert.equal(invoiceFigures.total, billedTotals.total);
  assert.deepEqual(invoiceFigures.rows.map((row) => row.gstPercent), [5, 5]);
});

test('invoice uses HSN GST rates from the billed line items', () => {
  const figures = invoice.computeInvoiceFigures(billedOrder());

  assert.equal(figures.subtotal, 1020);
  assert.equal(figures.tax, 45.9);
  assert.deepEqual(figures.rows.map((row) => ({
    hsn: row.hsn,
    gstPercent: row.gstPercent,
    lineTax: row.lineTax
  })), [
    { hsn: '1006', gstPercent: 5, lineTax: 28.8 },
    { hsn: '1512', gstPercent: 5, lineTax: 17.1 }
  ]);
});

test('invoice uses the same capped coupon discount and total as billing', () => {
  const figures = invoice.computeInvoiceFigures(billedOrder());

  assert.equal(figures.discount, 102);
  assert.equal(figures.total, 963.9);
  assert.equal(figures.discount, billedOrder().discount);
  assert.equal(figures.total, billedOrder().total);
});

test('GST reconciliation matches invoice and ledger totals', () => {
  const db = {
    orders: [billedOrder()]
  };

  const reconciliation = reports.getGstReconciliation(db);

  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.deepEqual(reconciliation.rows[0], {
    orderId: 1002,
    date: '05/01/2022',
    customer: 'Anil Kulkarni',
    coupon: 'SAVE10',
    ledgerSubtotal: 1020,
    ledgerDiscount: 102,
    ledgerTax: 45.9,
    ledgerTotal: 963.9,
    invoiceDiscount: 102,
    invoiceTax: 45.9,
    invoiceTotal: 963.9,
    delta: 0,
    matched: true
  });
});

test('rendered invoice omits reconciliation warning when totals match', () => {
  const html = invoice.render(billedOrder());

  assert.doesNotMatch(html, /Accountant Reconciliation Notice:/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹963\.90<\/td>/);
});
