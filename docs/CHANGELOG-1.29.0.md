# 1.29.0

* **Each phone has its own session.** A phone signs in with its own id; the session ends the moment the owner removes the phone (even if the cookie is copied elsewhere), and a removed phone cannot sign in again until allowed back.
* **Phone, offline:** Shift tab (clock in / clock out with unpaid break) and Receive stock, kept on the phone with the real time and sent once when online. A clash (already clocked in, a payroll already approved) is kept with the server's reason and a Try again button.
* **Stock areas:** set up places (dry store, walk-in fridge, freezer, bar), see each item by place, move stock between places (the item's total never changes), count one place at a time in Stock take.
* Migrations (additive): attendance_event_keys, stock_locations.
* Tested on an Android emulator against the live backend: offline events queued, synced once online, no duplicates.
