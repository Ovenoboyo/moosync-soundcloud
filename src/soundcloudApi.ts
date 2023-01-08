import { CacheHandler } from './cacheHandler'
import { Artists, Playlist, Song } from '@moosync/moosync-types'
import { URL, URLSearchParams } from 'url'
import https from 'https'

// https://github.com/DevAndromeda/soundcloud-scraper/blob/master/src/constants/Constants.js
const SCRIPT_URL_MATCH_REGEX =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/
const CLIENT_ID_MATCH_REGEX =
  /(https:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/

export class SoundcloudApi {
  private cacheHandler = new CacheHandler('./soundcloud.cache', false)
  private key?: string

  private async fetchKey() {
    const resp = await this.getRaw(new URL('https://soundcloud.com'))
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
        const data = await this.getRaw(new URL(u))
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

  private getRaw(url: URL) {
    return new Promise<string>((resolve, reject) => {
      const request = https.get({
        host: url.host,
        path: url.pathname + '?' + url.searchParams.toString(),
        headers: {
          'x-requested-with': 'https://soundcloud.com'
        }
      })

      request.on('response', (data) => {
        if (data.statusCode === 200) {
          let ret = ''
          data.on('data', (chunk) => (ret += chunk))
          data.on('end', () => resolve(ret))
          data.on('error', reject)
        } else {
          reject('Failed to fetch with status code ' + data.statusCode + ', ' + data.statusMessage)
        }
      })

      request.on('error', reject)
    })
  }

  private async get<T>(
    url: string,
    params: Record<string, string | number>,
    invalidateCache: boolean
  ): Promise<T | undefined> {
    const parsedParams = new URLSearchParams({
      ...params,
      client_id: this.key
    })
    const parsedUrl = new URL('https://api-v2.soundcloud.com' + url + '?' + parsedParams.toString())
    const cache = this.cacheHandler.getParsedCache<T>(parsedUrl.toString())
    if (cache && !invalidateCache) {
      return cache
    }

    const resp = JSON.parse(await this.getRaw(parsedUrl))
    this.cacheHandler.addToCache(url.toString(), resp)
    return resp
  }

  private async fetchTrackDetails(invalidateCache: boolean, ...ids: number[]) {
    const tracks: Tracks[] = []
    while (ids.length > 0) {
      const reducedIds = ids.splice(0, 49)
      const resp = await this.get<Tracks[]>(
        '/tracks',
        {
          ids: reducedIds.join(',')
        },
        invalidateCache
      )
      tracks.push(...resp)
    }

    return tracks
  }

  public async parseUrl(url: string, invalidateCache: boolean) {
    if (url.startsWith('https://soundcloud.com')) {
      const data = await this.get<{ kind: string }>(
        '/resolve',
        {
          url
        },
        invalidateCache
      )

      if (data.kind === 'track') {
        return await this.parseSongs(invalidateCache, data as Tracks)[0]
      }

      if (data.kind === 'playlist') {
        const details = await this.fetchTrackDetails(
          invalidateCache,
          ...(data as Playlists).tracks.map((val) => val.id)
        )
        return {
          playlist: this.parsePlaylists(data as Playlists)[0],
          songs: await this.parseSongs(invalidateCache, ...details)
        }
      }
    }
  }

  private parseArtists(...artists: UserInfo['collection']): Artists[] {
    const ret: Artists[] = []
    for (const data of artists) {
      ret.push({
        artist_id: data.urn.toString(),
        artist_name: data.full_name || data.username,
        artist_coverPath: data.avatar_url,
        artist_extra_info: {
          extensions: {
            [api.utils.packageName]: {
              artist_id: data.urn.replace('soundcloud:users:', '')
            }
          }
        }
      })
    }

    return ret
  }

  public async searchArtist(artist_name: string, invalidateCache: boolean) {
    try {
      const data = await this.get<UserInfo>(
        '/search/users',
        {
          q: artist_name,
          limit: 50
        },
        invalidateCache
      )

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

  public async searchPlaylists(term: string, invalidateCache: boolean) {
    const data = await this.get<PlaylistInfo>(
      '/search/playlists',
      {
        q: term,
        limit: 50
      },
      invalidateCache
    )

    return this.parsePlaylists(...data.collection)
  }

  public async searchSongs(term: string, invalidateCache: boolean) {
    const data = await this.get<TrackInfo>(
      '/search/tracks',
      {
        q: term,
        limit: 50
      },
      invalidateCache
    )

    return await this.parseSongs(invalidateCache, ...data.collection)
  }

  private paramsToObject(entries: IterableIterator<[string, string]>) {
    const result = {}
    for (const [key, value] of entries) {
      result[key] = value
    }
    return result
  }

  public async getSongStreamById(id: string, invalidateCache: boolean) {
    const cache = this.cacheHandler.getCache(`song:${id}`)
    let streamURL = ''
    if (cache) {
      streamURL = cache
    }

    console.log('finding url')
    if (!streamURL) {
      streamURL = this.findStreamURL(await this.getSongDetsById(id, invalidateCache))
      this.cacheHandler.addToCache(`song:${id}`, streamURL)
    }

    if (streamURL) return (await this.fetchFromStreamURL(streamURL)).url
  }

  public fetchFromStreamURL(url: string) {
    return new Promise<{ url: string }>((resolve, reject) => {
      console.log('fetching url from', url, this.key)
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

  private findStreamURL(track: Tracks) {
    const streamUrl = track.media.transcodings.find(
      (val) => val.format.protocol === 'progressive' && !val.url.includes('preview')
    )?.url

    return streamUrl
  }

  async getSongById(id: number, invalidateCache = false) {
    const dets = (await this.fetchTrackDetails(invalidateCache, id))[0]
    if (dets) {
      return (await this.parseSongs(invalidateCache, dets))[0]
    }
  }

  private async parseSongs(invalidateCache: boolean, ...tracks: TrackInfo['collection']) {
    const songs: Song[] = []

    for (let t of tracks) {
      if (!t.title && t.id) {
        t = await this.getSongDetsById(t.id.toString(), invalidateCache)
      }

      if (t.streamable && t.media?.transcodings) {
        const streamUrl = this.findStreamURL(t)
        if (streamUrl) {
          this.cacheHandler.addToCache(`song:${t.id}`, streamUrl)
          songs.push({
            _id: t.id.toString(),
            title: t.title,
            song_coverPath_high: t.artwork_url,
            duration: t.full_duration / 1000,
            url: t.uri,
            playbackUrl: `extension://${api.utils.packageName}/${t.id}`,
            date_added: Date.now(),
            date: t.release_date,
            genre: [t.genre],
            artists: [
              {
                artist_id: t.user_id.toString(),
                artist_name: t.user.full_name || t.user.username,
                artist_coverPath: t.user.avatar_url,
                artist_extra_info: {
                  extensions: {
                    [api.utils.packageName]: {
                      artist_id: t.urn.replace('soundcloud:users:', '')
                    }
                  }
                }
              }
            ],
            type: 'URL'
          })
        }
      }
    }

    return songs
  }

  public async getArtistSongs(urn: string, invalidateCache: boolean) {
    const tracks: Song[] = []

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

      const data = await this.get<TrackInfo>(`/users/${urn}/tracks`, params, invalidateCache)
      if (data.collection) {
        tracks.push(...(await this.parseSongs(invalidateCache, ...data.collection)))
      }

      next = data.next_href
    } while (tracks.length < 20 && next)

    return tracks
  }

  public async getSongDetsById(id: string, invalidateCache: boolean): Promise<Tracks> {
    const cache = this.cacheHandler.getCache(`songDets:${id}`)
    if (cache && !invalidateCache) {
      return JSON.parse(cache)
    }

    const trackDets = await this.get<Tracks>(`/tracks/${id}`, {}, invalidateCache)
    this.cacheHandler.addToCache(`songDets:${id}`, JSON.stringify(trackDets))
    return trackDets
  }

  public async getPlaylistSongs(playlistId: string, invalidateCache: boolean) {
    const data = await this.get<Playlists>(`/playlists/${playlistId}`, {}, invalidateCache)
    for (const track in data.tracks) {
      const t = data.tracks[track]
      if (!t.title && t.id) {
        data.tracks[track] = await this.getSongDetsById(t.id.toString(), invalidateCache)
      }
    }
    const parsedTracks = await this.parseSongs(invalidateCache, ...data.tracks)
    return parsedTracks
  }
}

// const api = {
//   packageName: 'moosync.soundcloud'
// }
// const scapi = new SoundcloudApi()
// scapi.generateKey().then(() => {
//   scapi.getPlaylistSongs('282620842').then(console.log)
// })
