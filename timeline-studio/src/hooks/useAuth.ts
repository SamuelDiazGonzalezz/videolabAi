import { useEffect, useState } from 'react';
import {
  type User,
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from '../firebase';
import {
  getUiLanguagePreference,
  setUiLanguagePreference,
  type UiLanguagePreference
} from '../i18n';

interface AuthState {
  user: User | null;
  loading: boolean;
  getToken: () => Promise<string>;
}

const FIRESTORE_USERS_ENDPOINT = 'https://firestore.googleapis.com/v1/projects/vidreum/databases/(default)/documents/users';

async function readLanguagePreference(user: User): Promise<UiLanguagePreference | undefined> {
  const token = await user.getIdToken();
  const response = await fetch(`${FIRESTORE_USERS_ENDPOINT}/${encodeURIComponent(user.uid)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!response.ok) return undefined;
  const profile = await response.json() as {
    fields?: { languagePreference?: { stringValue?: string } };
  };
  const preference = profile.fields?.languagePreference?.stringValue;
  return preference === 'auto' || preference === 'es' || preference === 'en'
    ? preference
    : undefined;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let authRevision = 0;
    return onAuthStateChanged(auth, (nextUser) => {
      const revision = ++authRevision;
      setUser(nextUser);
      setLoading(false);
      if (!nextUser) return;

      const expectedUid = nextUser.uid;
      const preferenceAtStart = getUiLanguagePreference();
      void readLanguagePreference(nextUser).then((preference) => {
        if (revision !== authRevision || auth.currentUser?.uid !== expectedUid) return;
        if (preference !== 'auto' && preference !== 'es' && preference !== 'en') return;
        if (getUiLanguagePreference() !== preferenceAtStart) return;
        if (preference !== getUiLanguagePreference()) setUiLanguagePreference(preference);
      }).catch(() => {
        // La preferencia local/automática sigue siendo válida si Firestore no responde.
      });
    });
  }, []);

  const getToken = async () => {
    if (!auth.currentUser) throw new Error('Inicia sesión para exportar el vídeo.');
    return auth.currentUser.getIdToken();
  };

  return { user, loading, getToken };
}
