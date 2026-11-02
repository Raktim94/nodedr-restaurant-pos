# Notes for App Review and Play review

OrderRestro is open-source restaurant software that each restaurant hosts on its own computer. This app is the staff and rider client, so it needs a server address on first launch.

**Demo server for reviewers:** https://orderrestro-demo.nodedr.com

1. Open the app. On the connect screen enter `orderrestro-demo.nodedr.com` and tap Connect.
2. Sign in as the manager: `reviewer@orderrestro.nodedr.com` / (password supplied in the review form).
3. Rider sign-in: phone number `9000000001` / (password in the review form). The rider screen shows deliveries; tap the toggle to go online (asks for location).
4. Account deletion: user menu (top right) > Delete my account.

Why the app is more than a website: native push notifications for new orders and deliveries, native location for riders, QR scanning to connect, haptic and sound alerts, a saved list of servers, an offline screen and a queue that keeps rider updates made with no signal.

The app asks for local network access (iOS) and allows plain http to private network addresses because a restaurant's server usually has no public certificate.
