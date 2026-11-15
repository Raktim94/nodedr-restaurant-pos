import test from 'node:test';
import assert from 'node:assert/strict';
import { afterRight, afterWrong, checkPin, hashPin, lockState, needsManager, pinTaken, validPin, weakPin, whoHasPin } from './staff.js';

test('a PIN is stored only as a salted hash and checks back', async () => {
  const pin = await hashPin('4821');
  assert.equal(pin.hash.length, 64);
  assert.ok(!JSON.stringify(pin).includes('4821'));
  assert.equal(await checkPin({ pin }, '4821'), true);
  assert.equal(await checkPin({ pin }, '4822'), false);
  const again = await hashPin('4821');
  assert.notEqual(again.hash, pin.hash); // a new salt each time
});

test('PIN rules: 4 to 8 digits, obvious ones flagged', () => {
  assert.equal(validPin('123'), false);
  assert.equal(validPin('12a4'), false);
  assert.equal(validPin('4821'), true);
  assert.equal(weakPin('1111'), true);
  assert.equal(weakPin('1234'), true);
  assert.equal(weakPin('4821'), false);
});

test('finds who a PIN belongs to and refuses a PIN someone else has', async () => {
  const staff = [
    { id: 'a', name: 'Asha', manager: true, pin: await hashPin('4821') },
    { id: 'b', name: 'Ravi', manager: false, pin: await hashPin('7360') },
    { id: 'c', name: 'Gone', active: false, pin: await hashPin('5555') },
  ];
  assert.equal((await whoHasPin(staff, '7360')).name, 'Ravi');
  assert.equal(await whoHasPin(staff, '5555'), null); // switched off
  assert.equal((await pinTaken(staff, '4821', 'b')).id, 'a');
  assert.equal(await pinTaken(staff, '4821', 'a'), null);
});

test('five wrong PINs lock the pad, and it doubles after that', () => {
  let t;
  for (let i = 0; i < 4; i++) t = afterWrong(t, 1000);
  assert.equal(lockState(t, 1000).locked, false);
  t = afterWrong(t, 1000);
  assert.equal(lockState(t, 1000).waitSeconds, 30);
  t = afterWrong(t, 1000);
  assert.equal(lockState(t, 1000).waitSeconds, 60);
  assert.deepEqual(afterRight(), { count: 0, until: 0 });
});

test('a manager is asked only when staff are set up and the person on the phone is not one', () => {
  assert.equal(needsManager([], null), false);
  assert.equal(needsManager([{ id: 'a' }], { manager: false }), true);
  assert.equal(needsManager([{ id: 'a' }], { manager: true }), false);
});
