import { MoosyncExtensionTemplate, Playlist, Song } from '@moosync/moosync-types'
import { SoundcloudApi } from './soundcloudApi'

export class SoundCloudExtension implements MoosyncExtensionTemplate {
  private soundcloudApi = new SoundcloudApi()
  async onStarted() {
    await this.fetchPreferences()
    this.registerListeners()
    console.info('Started soundcloud extension')
  }

  private async fetchPreferences() {
    const key = await api.getSecure<string>('apiKey')
    const gen = await this.soundcloudApi.generateKey(key)

    if (gen !== key) {
      await api.setSecure('apiKey', gen)
    }
  }

  private registerListeners() {
    api.on('requestedSearchResult', async (term) => {
      const songs = await this.soundcloudApi.searchSongs(term, false)
      const artists = await this.soundcloudApi.searchArtist(term, false)
      const playlists = await this.soundcloudApi.searchPlaylists(term, false)
      return {
        songs,
        artists,
        albums: [],
        playlists
      }
    })

    api.on('requestedArtistSongs', async (artist) => {
      const extraInfo = api.utils.getArtistExtraInfo(artist)
      let artistId: string
      if (!extraInfo || !extraInfo['artist_id']) {
        const soundcloudArtist = (await this.soundcloudApi.searchArtist(artist.artist_name, false))[0]
        if (soundcloudArtist) {
          artistId = api.utils.getArtistExtraInfo(soundcloudArtist).artist_id
          await api.setArtistEditableInfo(artist.artist_id, {
            artist_id: artistId
          })
        }
      } else {
        artistId = extraInfo['artist_id']
      }

      const songs = await this.soundcloudApi.getArtistSongs(artistId, false)
      return {
        songs
      }
    })

    api.on('requestedSongFromURL', async (url) => {
      const song = (await this.soundcloudApi.parseUrl(url, false)) as unknown as Song
      if (song) return { song }
    })

    api.on('requestedPlaylistFromURL', async (url) => {
      const data = (await this.soundcloudApi.parseUrl(url, false)) as unknown as { songs: Song[]; playlist: Playlist }
      if (data) return { songs: data.songs, playlist: data.playlist }
    })

    api.on('playbackDetailsRequested', async (song) => {
      // if (song.url) {
      // const data = await this.soundcloudApi.fetchFromStreamURL(song.url)
      // return { duration: song.duration, url: data.url }
      // }
    })

    api.on('customRequest', async (url) => {
      try {
        console.log('got custom request', url)
        const redirectUrl = await this.soundcloudApi.getSongStreamById(new URL(url).pathname.substring(1), false)
        console.log('got redirect url', redirectUrl)
        return { redirectUrl }
      } catch (e) {
        console.error(e, url)
      }
    })

    api.on('requestedPlaylistSongs', async (id, invalidateCache) => {
      const playlistId = id.replace('moosync.soundcloud:', '')
      const songs = await this.soundcloudApi.getPlaylistSongs(playlistId, invalidateCache)
      return {
        songs
      }
    })

    api.on('requestedSongFromId', async (id) => {
      const song = await this.soundcloudApi.getSongById(parseInt(id), false)
      return {
        song
      }
    })
  }
}
