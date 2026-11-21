var test = require('node:test');
var assert = require('node:assert/strict');

var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var config = require('../config');

test('invoice applies the checkout HSN slab to the same stored order line', function () {
  var items = [{ id: 1, name: 'Rice', sku: 'RICE', hsn: '1006', price: 100, qty: 1 }];
  var checkout = pricing.computeTotals(items, '');
  var db = { nextOrderId: 1, orders: [] };
  var order = orders.add(db, {
    items: items,
    subtotal: checkout.subtotal,
    discount: checkout.discount,
    tax: checkout.tax,
    total: checkout.total
  });
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.total, 105);
  assert.equal(order.tax, 5);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.total, order.total);
});

test('invoice figures match the order amount and GST billed at checkout', function () {
  var items = [{ id: 1, name: 'Rice', sku: 'RICE', hsn: '1006', price: 100, qty: 1 }];
  var checkout = pricing.computeTotals(items, '');
  var order = { id: 11, items: items, coupon: '', total: checkout.total };
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.tax, checkout.tax);
  assert.equal(figures.total, order.total);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.doesNotMatch(invoice.render(order), /differs from Order Ledger recorded total/);
});

test('invoice applies the checkout coupon discount to subtotal before GST', function () {
  var order = {
    items: [{ name: 'Rice', hsn: '1006', price: 100, qty: 1 }],
    coupon: 'WELCOME',
    total: 99.75
  };
  var checkout = pricing.computeTotals(order.items, order.coupon);
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(checkout.discount, 5);
  assert.equal(figures.discount, checkout.discount);
  assert.equal(figures.tax, checkout.tax);
  assert.equal(figures.total, order.total);
});

test('invoice preserves saved totals and line GST when tax and coupon settings later change', function () {
  var originalSlab = config.tax.hsnSlabs['1006'];
  var originalCouponValue = config.coupons.WELCOME.value;
  var order = {
    items: [{ name: 'Rice', hsn: '1006', gstRate: 5, price: 100, qty: 1 }],
    coupon: 'WELCOME',
    subtotal: 100,
    discount: 5,
    tax: 4.75,
    total: 99.75
  };

  try {
    config.tax.hsnSlabs['1006'] = 18;
    config.coupons.WELCOME.value = 20;
    var figures = invoice.computeInvoiceFigures(order);

    assert.equal(figures.rows[0].gstPercent, 5);
    assert.equal(figures.rows[0].lineTax, 4.75);
    assert.equal(figures.discount, 5);
    assert.equal(figures.tax, 4.75);
    assert.equal(figures.total, 99.75);
  } finally {
    config.tax.hsnSlabs['1006'] = originalSlab;
    config.coupons.WELCOME.value = originalCouponValue;
  }
});

test('invoice GST summary and split use checkout line rounding', function () {
  var figures = invoice.computeInvoiceFigures({
    items: [
      { name: 'A', price: 0.1, qty: 1, gstRate: 5 },
      { name: 'B', price: 0.1, qty: 1, gstRate: 5 }
    ]
  });

  assert.equal(figures.tax, 0.02);
  assert.equal(figures.cgst, 0.01);
  assert.equal(figures.sgst, 0.01);
  assert.equal(figures.cgst + figures.sgst, figures.tax);
  assert.deepEqual(figures.rows.map(function (row) { return row.lineTax; }), [0.01, 0.01]);
});

test('invoice renders the recorded billed total without a recomputation warning', function () {
  var html = invoice.render({
    id: 42,
    items: [{ name: 'Rice', hsn: '1006', price: 100, qty: 1 }],
    subtotal: 100,
    discount: 0,
    tax: 5,
    total: 105
  });

  assert.match(html, /Invoice Total/);
  assert.match(html, /105\.00/);
  assert.doesNotMatch(html, /differs from Order Ledger recorded total/);
});
