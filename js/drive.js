// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
// Reemplazá con tu Client ID después de crear la app en Google Cloud Console:
// console.cloud.google.com → APIs → Credenciales → OAuth 2.0 Client ID
const CLIENT_ID = (typeof CONFIG !== 'undefined' && CONFIG.GOOGLE_CLIENT_ID)
  ? CONFIG.GOOGLE_CLIENT_ID
  : 'TU_CLIENT_ID_AQUI';

const Drive = (() => {
  const FILE_NAME = 'tracker-personal-data.json';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events';

  let _token = null;
  let _fileId = null;
  let _driveModifiedTime = null;
  let _tokenClient = null;
  let _syncDebounce = null;

  // ─── STATUS UI ───────────────────────────────────────────────────────────────

  function _updateStatus(st) {
    const dot = document.getElementById('drive-dot');
    const label = document.getElementById('drive-label');
    if (!dot || !label) return;

    const map = {
      local: ['', 'Drive: local'],
      connected: ['connected', 'Drive: ok'],
      syncing: ['syncing', '↑ sincronizando...'],
      synced: ['connected', '✓ sincronizado'],
      error: ['error', '⚠ sin conexión'],
    };
    const [cls, text] = map[st] || map.local;
    dot.className = 'drive-dot' + (cls ? ' ' + cls : '');
    label.textContent = text;
  }

  function _showConnectButton() {
    const label = document.getElementById('drive-label');
    if (!label) return;
    label.innerHTML = `<button class="btn-icon" onclick="Drive.connect()">Conectar Drive</button>`;
    document.getElementById('drive-dot').className = 'drive-dot';
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────────

  function init() {
    if (CLIENT_ID === 'TU_CLIENT_ID_AQUI') {
      _updateStatus('local');
      return;
    }
    if (typeof google === 'undefined' || !google.accounts) {
      console.warn('Drive: GIS no está disponible');
      _updateStatus('local');
      return;
    }
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: _onToken,
    });
    _showConnectButton();
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────────

  async function _onToken(response) {
    if (response.error) {
      console.error('Drive auth error:', response.error);
      _updateStatus('error');
      return;
    }
    _token = response.access_token;
    _updateStatus('connected');
    await _loadFromDrive();
  }

  function connect() {
    if (!_tokenClient) return;
    _updateStatus('syncing');
    _tokenClient.requestAccessToken({ prompt: '' });
  }

  // ─── DRIVE API ────────────────────────────────────────────────────────────────

  async function _apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${_token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      _token = null;
      _showConnectButton();
      throw new Error('Token expirado — reconectá Drive');
    }
    return res;
  }

  async function _findFile() {
    if (_fileId) return _fileId;
    const res = await _apiFetch(
      `https://www.googleapis.com/drive/v3/files?q=name%3D'${FILE_NAME}'%20and%20trashed%3Dfalse&spaces=drive&fields=files(id%2CmodifiedTime)`
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      _fileId = data.files[0].id;
      _driveModifiedTime = data.files[0].modifiedTime;
    }
    return _fileId;
  }

  async function _createFile() {
    const form = new FormData();
    form.append('metadata', new Blob(
      [JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })],
      { type: 'application/json' }
    ));
    form.append('file', new Blob(
      [JSON.stringify(state)],
      { type: 'application/json' }
    ));
    const res = await _apiFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2CmodifiedTime',
      { method: 'POST', body: form }
    );
    const data = await res.json();
    _fileId = data.id;
    _driveModifiedTime = data.modifiedTime;
  }

  async function _uploadFile() {
    if (!_fileId) { await _createFile(); return; }
    const res = await _apiFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${_fileId}?uploadType=media&fields=modifiedTime`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }
    );
    const data = await res.json();
    if (data.modifiedTime) _driveModifiedTime = data.modifiedTime;
  }

  // ─── SYNC LOGIC ───────────────────────────────────────────────────────────────

  async function _loadFromDrive() {
    try {
      _updateStatus('syncing');
      const fid = await _findFile();

      if (!fid) {
        // Primera vez — subir el estado local actual
        await _createFile();
        _updateStatus('synced');
        return;
      }

      const driveTime = new Date(_driveModifiedTime).getTime();
      const localTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;

      if (driveTime > localTime) {
        // Drive es más nuevo → descargar y reemplazar local
        const res = await _apiFetch(
          `https://www.googleapis.com/drive/v3/files/${fid}?alt=media`
        );
        const driveState = await res.json();
        const migrated = migrateSchema(driveState);
        Object.assign(state, migrated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      } else if (localTime > driveTime) {
        // Local es más nuevo → subir a Drive
        await _uploadFile();
      }

      _updateStatus('synced');
    } catch (e) {
      console.error('Drive load error:', e);
      _updateStatus('error');
    }
  }

  function sync() {
    if (!_token) return;
    clearTimeout(_syncDebounce);
    _updateStatus('syncing');
    _syncDebounce = setTimeout(async () => {
      try {
        await _uploadFile();
        _updateStatus('synced');
      } catch (e) {
        console.error('Drive sync error:', e);
        _updateStatus('error');
      }
    }, 2000);
  }

  // ─── API PÚBLICA ─────────────────────────────────────────────────────────────

  return { init, connect, sync, getToken: () => _token };
})();
