# Golf Pool Snake Draft App

This is a Vite + React app for a private golf pool with:
- Google login via Firebase Authentication
- Firestore-backed private pools
- Commissioner controls
- 3-player snake draft
- Live PGA scoring through BallDontLie PGA API
- Mobile-friendly UI

## 1. Install dependencies
```bash
npm install
```

## 2. Create your environment file
Copy `.env.example` to `.env` and fill in your real values.

## 3. Run locally
```bash
npm run dev
```

## 4. Deploy to Vercel
Upload this folder to GitHub, then import the repo into Vercel.

## 5. Firebase setup
Enable:
- Authentication → Google
- Firestore Database

Add your Vercel domain to Firebase Authentication authorized domains.

## 6. Firestore rules
The app displays recommended rules inside the UI. Copy those into Firebase Console → Firestore Database → Rules.

## Notes
- The tournament field endpoint may require a BallDontLie PGA plan that includes it.
- The live results endpoint must be available on your PGA API plan.