import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
import {QueuedPlaylist} from './player.js';

const HARD_PLAYLIST_FETCH_LIMIT = 5000; // Define the hard limit

export interface SpotifyTrack {
  name: string;
  artist: string;
}

@injectable()
export default class {
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.spotify = thirdParty.spotify;
  }

  async getAlbum(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    try {
      const uri = spotifyURI.parse(url) as spotifyURI.Album;
      const [
        {body: album},
        {
          body: {items},
        },
      ] = await Promise.all([
        this.spotify.getAlbum(uri.id),
        this.spotify.getAlbumTracks(uri.id, {limit: 50}),
      ]);
      const tracks = items.map(this.toSpotifyTrack);
      const playlist = {title: album.name, source: album.href};

      return [tracks, playlist];
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch Spotify album: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getPlaylist(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    try {
      const uri = spotifyURI.parse(url) as spotifyURI.Playlist;

      let [{body: playlistResponse}, {body: tracksResponse}]
        = await Promise.all([
          this.spotify.getPlaylist(uri.id),
          this.spotify.getPlaylistTracks(uri.id, {limit: 50}),
        ]);

      const items = tracksResponse.items.map(
        playlistItem => playlistItem.track,
      );
      const playlist = {
        title: playlistResponse.name,
        source: playlistResponse.href,
      };

      while (tracksResponse.next && items.length < HARD_PLAYLIST_FETCH_LIMIT) {
        // eslint-disable-next-line no-await-in-loop
        ({body: tracksResponse} = await this.spotify.getPlaylistTracks(
          uri.id,
          {
            limit: parseInt(
              new URL(tracksResponse.next).searchParams.get('limit') ?? '50',
              10,
            ),
            offset: parseInt(
              new URL(tracksResponse.next).searchParams.get('offset') ?? '0',
              10,
            ),
          },
        ));

        items.push(
          ...tracksResponse.items.map(playlistItem => playlistItem.track),
        );
      }

      const tracks = items.filter(
        i => i !== null,
      ) as SpotifyApi.TrackObjectSimplified[];
      const limitedTracks = tracks
        .slice(0, HARD_PLAYLIST_FETCH_LIMIT)
        .map(this.toSpotifyTrack);

      return [limitedTracks, playlist];
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch Spotify playlist: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getTrack(url: string): Promise<SpotifyTrack> {
    try {
      const uri = spotifyURI.parse(url) as spotifyURI.Track;
      const {body} = await this.spotify.getTrack(uri.id);

      return this.toSpotifyTrack(body);
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch Spotify track: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getArtist(url: string): Promise<SpotifyTrack[]> {
    try {
      const uri = spotifyURI.parse(url) as spotifyURI.Artist;
      const {body} = await this.spotify.getArtistTopTracks(uri.id, 'US');

      const tracks = body.tracks
        .slice(0, HARD_PLAYLIST_FETCH_LIMIT)
        .map(this.toSpotifyTrack);

      return tracks;
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch Spotify artist: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toSpotifyTrack(
    track: SpotifyApi.TrackObjectSimplified,
  ): SpotifyTrack {
    return {
      name: track.name,
      artist: track.artists[0].name,
    };
  }
}
