# 1.30.0

* **Customer screen** (`/customer-display?t=TOKEN`): its own device, server-synced, adverts while idle (pictures and short videos, per screen), the live order the instant one starts, thank-you, idle timeout, keeps its picture if the connection drops. Settings > Customer screen.
* **Table ordering**: guests choose *pay at the register* or *pay on my phone* (when a gateway is on); retry-safe (no duplicate orders); online-pay orders are held from the kitchen until the payment is confirmed; clear status, failure and switch-to-cash handling. Staff see "Cash due at register" / "Waiting for online payment" and can send an order to the kitchen anyway (audited).
* **Paging**: one buzzer per table (Settings > Buzzers), called from the kitchen's **Call buzzer** button; polling device or signed webhook; offline and failed calls are reported, not hidden.
* **Table cards**: QR + NFC link per table, printable.
* **Simulator** (Settings > Simulator): till, customer display in device sizes, guest phone, kitchen and a pretend buzzer, to test before the hardware arrives.
* Migration (additive): table_ordering_paging_display.
* Not tested on real TPV, tablet, buzzers or NFC cards. See docs/TPV-AND-TABLE-ORDERING.md.
