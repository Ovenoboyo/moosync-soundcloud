import { CacheHandler } from './cacheHandler'
import Soundcloud from 'soundcloud-scraper'
import { Playlist, Song } from '@moosync/moosync-types'

export class SoundcloudApi {
  private cacheHandler = new CacheHandler('./soundcloud.cache', false)
  private client?: Soundcloud.Client

  public async generateKey(key?: string) {
    if (!key) {
      key = await Soundcloud.Util.keygen()
    }

    this.client = new Soundcloud.Client(key)
    return key
  }

  public async searchSong(term: string) {
    let data: Soundcloud.SearchResult[] = this.cacheHandler.getParsedCache(`search:${term}`)
    if (!data) {
      data = await this.client?.search(term, 'track')
      this.cacheHandler.addToCache(`search:${term}`, JSON.stringify(data))
    }

    const songs: Song[] = []
    for (const s of data) {
      songs.push(await this.getSong(s.url))
    }

    return songs
  }

  private parseSong(song: Soundcloud.Song): Song {
    return {
      _id: song.id,
      title: song.title,
      song_coverPath_high: song.thumbnail,
      url: song.url,
      duration: song.duration / 1000,
      date_added: Date.now(),
      date: song.publishedAt.toString(),
      playbackUrl: song.streamURL,
      genre: [song.genre],
      artists: [
        {
          artist_id: song.author.urn.toString(),
          artist_name: song.author.name,
          artist_coverPath: song.author.avatarURL
        }
      ],
      type: 'URL'
    }
  }

  public async getSong(url: string) {
    try {
      let data: Soundcloud.Song = this.cacheHandler.getParsedCache(`song:${url}`)
      if (!data) {
        data = await this.client?.getSongInfo(url.substring(0, url.indexOf('?')), {
          fetchStreamURL: true
        })
        this.cacheHandler.addToCache(`song:${url}`, JSON.stringify(data))
      }

      return this.parseSong(data)
    } catch (e) {
      console.debug('Failed to parse URL as soundcloud track', e)
    }
  }

  private parsePlaylist(playlist: Soundcloud.Playlist): { playlist: Playlist; songs: Song[] } {
    return {
      playlist: {
        playlist_id: playlist.id.toString(),
        playlist_name: playlist.title,
        playlist_desc: playlist.description,
        playlist_coverPath: playlist.thumbnail
      },
      songs: playlist.tracks.map((val) => this.parseSong(val))
    }
  }

  public async getPlaylist(url: string) {
    try {
      let data: Soundcloud.Playlist = this.cacheHandler.getParsedCache(`playlist:${url}`)
      if (!data) {
        data = await this.client?.getPlaylist(url.substring(0, url.indexOf('?')))
        this.cacheHandler.addToCache(`playlist:${url}`, JSON.stringify(data))
      }
      return this.parsePlaylist(data)
    } catch (e) {
      console.debug('Failed to parse URL as soundcloud playlist', e)
    }
  }
}
