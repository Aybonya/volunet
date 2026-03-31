# Volunet

Expo React Native mobile app for volunteers and organizations.

## What You Need

- Node.js 18+
- npm
- Expo Go on your phone
- the `.env` file provided by the project author

The team leader already sent organizer Maxim the exactly filled `.env` file for this project.

## Run The Project

1. Clone the repository

```bash
git clone https://github.com/Aybonya/volunet.git
cd volunet
```

2. Install dependencies

```bash
npm install
```

3. Put the provided `.env` file in the project root

The `.env` file must be in the same folder as `package.json`.
If you are Maxim, use the exactly filled `.env` file sent by the team leader.

4. Start Expo

```bash
npx expo start
```

Then open Expo Go and scan the QR code.

## If Expo Has Network Problems

Use the local fallback:

```bash
npx expo start --offline --clear --port 8083 --max-workers 1
```

If both phones are on the same Wi‑Fi, they can open the same local Expo session.

## Main Stack

- Expo
- React Native
- TypeScript
- Firebase
- OpenAI API

## Notes

- This project is made for mobile, not web.
- The app uses the values from `.env` directly.
- If you change `.env`, restart Expo.
- Do not commit the real `.env` to GitHub.
