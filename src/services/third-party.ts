import {inject, injectable} from 'inversify';
import SpotifyWebApi from 'spotify-web-api-node';
import pRetry from 'p-retry';
import {TYPES} from '../types.js';
import Config from './config.js';

@injectable()
export default class ThirdParty {
  readonly spotify: SpotifyWebApi;

  private spotifyTokenTimerId?: NodeJS.Timeout;
  private readonly useUserAuth: boolean;

  constructor(@inject(TYPES.Config) config: Config) {
    this.spotify = new SpotifyWebApi({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET,
    });

    // Prefer public (client credentials) unless explicitly enabled via env flag
    const preferUserAuth = process.env.SPOTIFY_USE_USER_AUTH === 'true';
    this.useUserAuth = preferUserAuth && Boolean(config.SPOTIFY_USER_ACCESS_TOKEN && config.SPOTIFY_USER_REFRESH_TOKEN);

    if (this.useUserAuth) {
      console.log('🎵 Using Spotify user authentication');
      this.spotify.setAccessToken(config.SPOTIFY_USER_ACCESS_TOKEN!);
      this.spotify.setRefreshToken(config.SPOTIFY_USER_REFRESH_TOKEN!);
      void this.refreshUserToken();
    } else {
      console.log('🎵 Using Spotify client credentials');
      void this.refreshSpotifyToken();
    }
  }

  cleanup() {
    if (this.spotifyTokenTimerId) {
      clearTimeout(this.spotifyTokenTimerId);
    }
  }

  private async refreshSpotifyToken() {
    await pRetry(async () => {
      const auth = await this.spotify.clientCredentialsGrant();
      this.spotify.setAccessToken(auth.body.access_token);
      this.spotifyTokenTimerId = setTimeout(this.refreshSpotifyToken.bind(this), (auth.body.expires_in / 2) * 1000);
    }, {retries: 5});
  }

  private async refreshUserToken() {
    await pRetry(async () => {
      const auth = await this.spotify.refreshAccessToken();
      this.spotify.setAccessToken(auth.body.access_token);
      this.spotifyTokenTimerId = setTimeout(this.refreshUserToken.bind(this), (auth.body.expires_in / 2) * 1000);
    }, {retries: 5});
  }
}
