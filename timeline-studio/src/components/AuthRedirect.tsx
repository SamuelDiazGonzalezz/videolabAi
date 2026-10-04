import { useLayoutEffect } from 'react';

const VIDEO_EDITOR_AUTH_RETURN_KEY = 'vidreum.video-editor-auth-return.v1';

function isLocalViteEditor(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    && window.location.port === '5173';
}

function mainAuthUrl(): URL {
  const mainOrigin = isLocalViteEditor()
    ? `${window.location.protocol}//${window.location.hostname}:4173`
    : window.location.origin;
  const url = new URL('/index.html', mainOrigin);
  url.searchParams.set('auth', 'login');
  url.searchParams.set('intent', 'create');
  url.searchParams.set('from', 'video-editor');
  return url;
}

function editorReturnTarget(): string {
  return isLocalViteEditor()
    // Firebase Auth persiste por origen (incluido el puerto). Volver a 5173
    // dejaría al editor sin la sesión creada en 4173 y provocaría un bucle.
    ? `/timeline-studio/dist/index.html${window.location.search}${window.location.hash}`
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Timeline Studio no mantiene una segunda pantalla de acceso. Si Firebase no
 * encuentra una sesión, deja el destino en la pestaña y abre el login general
 * de Vidreum; esa pantalla consume el registro al terminar la autenticación.
 */
export function AuthRedirect() {
  const authUrl = mainAuthUrl();

  useLayoutEffect(() => {
    const target = editorReturnTarget();
    let stored = false;
    try {
      window.sessionStorage.setItem(VIDEO_EDITOR_AUTH_RETURN_KEY, JSON.stringify({
        source: 'video-editor',
        target,
        createdAt: Date.now()
      }));
      stored = true;
    } catch {
      // Si el navegador bloquea sessionStorage, returnTo mantiene el flujo.
    }

    // Vite vive en otro origen durante desarrollo, por lo que no comparte el
    // sessionStorage de localhost:4173. El fallback también cubre navegadores
    // que hayan deshabilitado el almacenamiento de sesión.
    if (!stored || authUrl.origin !== window.location.origin) {
      authUrl.searchParams.set('returnTo', target);
    }
    window.location.replace(authUrl.href);
  }, [authUrl.href]);

  return (
    <div className="app app--loading" role="status" aria-live="polite">
      Abriendo el inicio de sesión…
    </div>
  );
}
