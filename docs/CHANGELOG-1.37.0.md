# 1.37.0

* **Phone app: stock transfers and corrections work offline.** Kitchen tab gains **Move stock** (between places) and **Correct stock** (remove or add the difference, reason required). They are saved on the phone, sent when online as posted stock journal entries, and can never post twice (each has its own key). The server's reason is shown if it refuses (for example not enough in that place), with **Try again** and **Set aside**.
* **Phone app offline fixes.**
  * Kitchen records and bookings waiting to send are now counted: Kitchen tab badge, Sync screen, and the sign-out warning (it only counted sales before).
  * A refused kitchen record can be set aside instead of retrying forever.
  * A failed sales upload no longer stops kitchen records and bookings from sending; each part is tried on its own and the real error is shown.
  * A double tap on Save can no longer record the same stock movement twice, and a full phone shows a message instead of failing silently.
  * The phone asks the system not to clear its saved sales and records when space runs low.
  * Sent kitchen records older than two weeks are pruned; a menu older than a day is flagged on the Sync screen.
* Windows app (MSIX 1.0.13.0) bundles this server version.
