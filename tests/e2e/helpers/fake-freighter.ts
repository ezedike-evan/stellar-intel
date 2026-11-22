export const FAKE_PUBLIC_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Init script that makes the page believe Freighter is installed, connected and on PUBLIC. */
export function fakeFreighterInitScript(publicKey: string = FAKE_PUBLIC_KEY): string {
  return `
    window.freighter = true;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      const messageId = data.messageId;
      let payload = {};
      if (data.type === 'REQUEST_PUBLIC_KEY' || data.type === 'REQUEST_ACCESS') {
        payload = { publicKey: ${JSON.stringify(publicKey)} };
      } else if (data.type === 'REQUEST_NETWORK_DETAILS') {
        payload = {
          networkDetails: {
            network: 'PUBLIC',
            networkName: 'PUBLIC',
            networkUrl: 'https://horizon.stellar.org',
            networkPassphrase: 'Public Global Stellar Network ; September 2015',
          },
        };
      } else if (data.type === 'REQUEST_NETWORK') {
        payload = {
          network: 'PUBLIC',
          networkPassphrase: 'Public Global Stellar Network ; September 2015',
        };
      } else if (data.type === 'REQUEST_ALLOWED_STATUS') {
        payload = { isAllowed: true };
      } else if (data.type === 'REQUEST_CONNECTION_STATUS') {
        payload = { isConnected: true };
      }
      window.postMessage(
        { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: messageId, ...payload },
        window.location.origin
      );
    });
  `;
}

/** Writes intent-templates:v1:<publicKey> only if the key is absent so reloads keep user changes. */
export function seedTemplatesInitScript(publicKey: string, templates: object[]): string {
  return `
    const key = 'intent-templates:v1:' + ${JSON.stringify(publicKey)};
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(${JSON.stringify(templates)}));
    }
  `;
}
