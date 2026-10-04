import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Mismo proyecto Firebase que usa vidreum.ai2 (firebase.js) — un usuario que
// ya tiene cuenta en la app principal puede iniciar sesión aquí igual.
const firebaseConfig = {
  apiKey: 'AIzaSyCBs2akTezPTYvjmt8bTdDLEIScCWMvD1s',
  authDomain: 'vidreum.com',
  projectId: 'vidreum',
  storageBucket: 'vidreum.firebasestorage.app',
  messagingSenderId: '1088285159461',
  appId: '1:1088285159461:web:ae891e6ec2375be34d0fcc'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
