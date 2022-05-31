import { MoosyncExtensionTemplate } from '@moosync/moosync-types'
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
    api.on('requestSearchResult', async (term) => {
      const songs = await this.soundcloudApi.searchSong(term)
      return {
        providerName: 'Soundcloud',
        songs
      }
    })

    api.on('requestedSongFromURL', async (url) => {
      const song = await this.soundcloudApi.getSong(url)
      if (song) return { song }
    })

    api.on('requestedPlaylistFromURL', async (url) => {
      const data = await this.soundcloudApi.getPlaylist(url)
      if (data) return { songs: data.songs, playlist: data.playlist }
    })

    api.on('playbackDetailsRequested', async (song) => {
      if (song.url) {
        const data = await this.soundcloudApi.getSong(song.url)
        return { duration: data.duration, url: data.playbackUrl }
      }
    })
  }
}
