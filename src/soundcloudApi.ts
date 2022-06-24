import { CacheHandler } from './cacheHandler'
import { Artists, Playlist, Song } from '@moosync/moosync-types'
import { URL, URLSearchParams } from 'url'
import https from 'https'

const SCRIPT_URL_MATCH_REGEX =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/
const CLIENT_ID_MATCH_REGEX =
  /(https:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/
export class SoundcloudApi {
  private cacheHandler = new CacheHandler('./soundcloud.cache', false)
  // private client?: Soundcloud.Client
  private key?: string

  private async fetchKey() {
    const resp = await (await fetch('https://soundcloud.com')).text()
    const scripts = resp.split('<script crossorigin src="')
    const urls: string[] = []
    scripts.forEach((val) => {
      let url = val.replace('"></script>', '')
      let chunk = url.split('\n')[0]
      if (SCRIPT_URL_MATCH_REGEX.test(chunk)) {
        urls.push(chunk)
      }
    })

    for (const u of urls) {
      if (CLIENT_ID_MATCH_REGEX.test(u)) {
        const data = await (await fetch(u)).text()
        if (data.includes(',client_id:"')) {
          const a = data.split(',client_id:"')
          return a[1].split('"')[0]
        }
      }
    }
  }

  public async generateKey(key?: string) {
    if (!key) {
      key = await this.fetchKey()
    }

    this.key = key

    return key
  }

  private async get<T>(url: string, params: Record<string, string | number>): Promise<T | undefined> {
    return new Promise<T>((resolve, reject) => {
      const parsedParams = new URLSearchParams({
        ...params,
        client_id: this.key
      })
      const parsedUrl = new URL('https://api-v2.soundcloud.com' + url + '?' + parsedParams.toString())

      const request = https.get({
        host: parsedUrl.host,
        path: parsedUrl.pathname + '?' + parsedUrl.searchParams.toString(),
        headers: {
          'x-requested-with': 'https://soundcloud.com'
        }
      })

      request.on('response', (data) => {
        if (data.statusCode === 200) {
          let ret = ''
          data.on('data', (chunk) => (ret += chunk))
          data.on('end', () => resolve(JSON.parse(ret)))
          data.on('error', reject)
        } else {
          reject('Failed to fetch with status code ' + data.statusCode + ', ' + data.statusMessage)
        }
      })

      request.on('error', reject)
    })
  }

  public async parseUrl(url: string) {
    if (url.startsWith('https://soundcloud.com')) {
      const data = await this.get<{ kind: string }>('/resolve', {
        url
      })
      if (data.kind === 'track') {
        return this.parseSongs(data as Tracks)[0]
      }

      if (data.kind === 'playlist') {
        return {
          playlist: this.parsePlaylists(data as Playlists)[0],
          songs: this.parseSongs(...(data as Playlists).tracks)
        }
      }
    }
  }

  private parseArtists(...artists: UserInfo['collection']): Artists[] {
    const ret: Artists[] = []
    for (const data of artists) {
      ret.push({
        artist_id: data.urn.toString(),
        artist_name: data.full_name ?? data.username,
        artist_coverPath: data.avatar_url,
        artist_extra_info: {
          extensions: {
            'moosync.soundcloud': {
              artist_id: data.urn.replace('soundcloud:users:', '')
            }
          }
        }
      })
    }

    return ret
  }

  public async searchArtist(artist_name: string) {
    try {
      const data = await this.get<UserInfo>('/search/users', {
        q: artist_name,
        limit: 50
      })

      return this.parseArtists(...data.collection)
    } catch (e) {
      console.error(e)
    }
  }

  private parsePlaylists(...playlists: PlaylistInfo['collection']) {
    const ret: Playlist[] = []
    for (const p of playlists) {
      ret.push({
        playlist_id: p.id.toString(),
        playlist_name: p.title,
        playlist_desc: p.description,
        playlist_coverPath: p.artwork_url ?? p.tracks.find((val) => val.artwork_url)?.artwork_url
      })
    }
    return ret
  }

  public async searchPlaylists(term: string) {
    const data = await this.get<PlaylistInfo>('/search/playlists', {
      q: term,
      limit: 50
    })

    return this.parsePlaylists(...data.collection)
  }

  public async searchSongs(term: string) {
    const data = await this.get<TrackInfo>('/search/tracks', {
      q: term,
      limit: 50
    })

    return this.parseSongs(...data.collection)
  }

  private paramsToObject(entries: IterableIterator<[string, string]>) {
    const result = {}
    for (const [key, value] of entries) {
      result[key] = value
    }
    return result
  }

  public fetchStreamURL(url: string) {
    return new Promise<{ url: string }>((resolve, reject) => {
      const parsedUrl = new URL(url)
      const request = https.get({
        host: parsedUrl.host,
        path: parsedUrl.pathname + '?' + 'client_id=' + this.key,
        headers: {
          'x-requested-with': 'https://soundcloud.com'
        }
      })

      request.on('response', (data) => {
        if (data.statusCode === 200) {
          let ret = ''
          data.on('data', (chunk) => (ret += chunk))
          data.on('end', () => resolve(JSON.parse(ret)))
          data.on('error', reject)
        } else {
          reject('Failed to fetch with status code ' + data.statusCode + ', ' + data.statusMessage)
        }
      })

      request.on('error', reject)
    })
  }

  private parseSongs(...tracks: TrackInfo['collection']) {
    const songs: Song[] = []

    for (const t of tracks) {
      if (t.streamable && t.media) {
        songs.push({
          _id: t.id.toString(),
          title: t.title,
          song_coverPath_high: t.artwork_url,
          duration: t.full_duration / 1000,
          url: t.media.transcodings[1].url,
          date_added: Date.now(),
          date: t.release_date,
          genre: [t.genre],
          artists: [
            {
              artist_id: t.user_id.toString(),
              artist_name: t.user.full_name ?? t.user.username,
              artist_coverPath: t.user.avatar_url
            }
          ],
          type: 'URL'
        })
      }
    }

    return songs
  }

  public async getArtistSongs(urn: string) {
    const tracks = []

    let next = ''
    do {
      let params = {
        limit: 20
      }

      if (next) {
        params = {
          ...params,
          ...this.paramsToObject(new URL(next).searchParams.entries())
        }
      }

      const data = await this.get<TrackInfo>(`/users/${urn}/tracks`, params)
      if (data.collection) {
        tracks.push(...this.parseSongs(...data.collection))
      }

      next = data.next_href
    } while (tracks.length < 20 && next)

    return tracks
  }
}

const scapi = new SoundcloudApi()
scapi.generateKey('wWZrDYsQemr1p5WldG0mp2zzuwhoSMG2').then(() => {
  scapi.searchSongs('hello').then(console.log)
})
