const PlexAPI = require("plex-api");
const db = require('@inrixia/db')
const Subscription = require('./lib/subscription.js')

const path = require('path')
const { loopError } = require('@inrixia/helpers/object')
const { getDistance } = require('@inrixia/helpers/geo')
const prompts = require('./lib/prompts/')

const multiprogress = (require("multi-progress"))(process.stdout);

const settings = new db(path.join(__dirname, `./config/settings.json`))
console.log(path.join(__dirname, `./config/settings.json`))
const auth = new db('./db/auth.json', settings.auth.encrypt?settings.auth.encryptionKey:null)

const defaults = require('./lib/defaults.json')

let plexClient;

const fApi = new (require('floatplane'))
fApi.headers['User-Agent'] = `FloatplaneDownloader/${require('./package.json').version} (Inrix, +https://github.com/Inrixia/Floatplane-Downloader)`
fApi.cookie = auth.cookie||''

/**
 * Determine the edge closest to the client
 * @param {{
		edges: Array<{
			hostname: string,
			allowDownload: boolean,
			datacenter: {
				latitude: number,
				longitude: number
			}
		}>,
		client: {
			latitude: number,
			longitude: number,
		}
	}} edges 
 */
const findClosestEdge = edges => edges.edges.filter(edge => edge.allowDownload).reduce((bestEdge, edge) => {
	edge.distanceToClient = getDistance(edge.datacenter, edges.client)
	if (bestEdge === null) bestEdge = edge
	return (edge.distanceToClient < bestEdge.distanceToClient)?edge:bestEdge
}, null)

/**
 * Main function that triggeres everything else in the script
 */
const start = async () => {
	if (settings.floatplane.findClosestEdge) {
		console.log("> Finding closest edge server")
		settings.floatplane.edge = `https://${findClosestEdge(await fApi.api.edges()).hostname}`;
		console.log(`\n\u001b[36mFound! Using Server \u001b[0m[\u001b[38;5;208m${settings.floatplane.edge}\u001b[0m]`);
	}

	// Fetch subscriptions from floatplane
	const SUBS = (await floatplaneClient.fetchSubscriptions()).map(subscription => {
		if (
			subscription.plan.title == 'Linus Tech Tips' ||
			subscription.plan.title == 'LTT Supporter (OG)' ||
			subscription.plan.title == 'LTT Supporter (1080p)' ||
			subscription.plan.title == 'LTT Supporter Plus'
		) subscription.plan.title = 'Linus Tech Tips'

		// Add the subscription to settings if it doesnt exist
		if (settings.subscriptions[subscription.creator] == undefined) {
			settings.subscriptions[subscription.creator] = {
				id: subscription.creator,
				title: subscription.plan.title,
				enabled: true,
				subchannels: subchanneDefaults[subscription.plan.title.toLowerCase()]
			}
		}
		if (!subscription.enabled) return null

		subscription.enabled = settings.subscriptions[subscription.creator].enabled
		subscription.subchannels = settings.subscriptions[subscription.creator].subchannels

		return new Subscription(subscription)
	}).filter(SUB => SUB!=null)

	console.log(SUBS)


	// 	await Promise.all(Object.keys(settings.subscriptions).map(async key => {
	// 		const subscription = settings.subscriptions[key];
	// })
	
	
	


	
	// console.log('> Updated subscriptions!')
	// for (let i = 0; i < channels.length; i++) {
	// 	await channels[i].fetchVideos()
	// 	if (channels[i].enabled) channels[i].downloadVideos()
	// }
}

const downloadVideo = video => { // This handles resuming downloads, its very similar to the download function with some changes
	let videoSize = videos[video.guid].size ? videos[video.guid].size : 0 // // Set the total size to be equal to the stored total or 0
	let videoDownloadedBytes = videos[video.guid].transferred ? videos[video.guid].transferred : 0; // Set previousTransferred as the previous ammount transferred or 0
	let fileOptions = { start: videoDownloadedBytes, flags: videos[video.guid].file ? 'r+' : 'w' };
	let displayTitle = '';
	// If this video was partially downloaded
	if (videos[video.guid].partial) displayTitle = pad(`${colourList[video.subChannel]}${video.subChannel}\u001b[0m> ${video.title.slice(0,35)}`, 36) // Set the title for being displayed and limit it to 25 characters
	else displayTitle = pad(`${colourList[video.subChannel]}${video.subChannel}\u001b[0m> ${video.title.slice(0,25)}`, 29) // Set the title for being displayed and limit it to 25 characters
	
	const bar = multi.newBar(':title [:bar] :percent :stats', { // Create a new loading bar
		complete: '\u001b[42m \u001b[0m',
		incomplete: '\u001b[41m \u001b[0m',
		width: 30,
		total: 100
	})
	progress(floatRequest({ // Request to download the video
		url: video.url,
		headers: (videos[video.guid].partial) ? { // Specify the range of bytes we want to download as from the previous ammount transferred to the total, meaning we skip what is already downlaoded
			Range: `bytes=${videos[video.guid].transferred}-${videos[video.guid].size}`
		} : {}
	}), {throttle: settings.downloadUpdateTime}).on('progress', function (state) { // Run the below code every downloadUpdateTime while downloading
		if (!videos[video.guid].size) {
			videos[video.guid].size = state.size.total;
			videos[video.guid].partial = true
			videos[video.guid].file = video.rawPath+video.title+'.mp4.part';
			saveVideoData();
		}
		// Set the amount transferred to be equal to the preious ammount plus the new ammount transferred (Since this is a "new" download from the origonal transferred starts at 0 again)
		if (state.speed == null) {state.speed = 0} // If the speed is null set it to 0
		bar.update((videoDownloadedBytes+state.size.transferred)/videos[video.guid].size) // Update the bar's percentage with a manually generated one as we cant use progresses one due to this being a partial download
		// Tick the bar same as above but the transferred value needs to take into account the previous amount.
		bar.tick({'title': displayTitle, 'stats': `${((state.speed/100000)/8).toFixed(2)}MB/s ${((videoDownloadedBytes+state.size.transferred)/1024000).toFixed(0)}/${((videoDownloadedBytes+state.size.total)/1024000).toFixed(0)}MB ETA: ${Math.floor(state.time.remaining/60)}m ${Math.floor(state.time.remaining)%60}s`})
		videoSize = (videoDownloadedBytes+state.size.total/1024000).toFixed(0) // Update Total for when the download finishes
		//savePartialData(); // Save this data
	}).on('error', function(err, stdout, stderr) { // On a error log it
		if (videos[video.guid].partial) fLog(`Resume > An error occoured for "${video.title}": ${err}`)
		else fLog('Download > An error occoured for "'+video.title+'": '+err)
		console.log(`An error occurred: ${err.message} ${err} ${stderr}`);
	}).on('end', function () { // When done downloading
		fLog(`Download > Finished downloading: "${video.title}"`)
		bar.update(1) // Set the progress bar to 100%
		// Tick the progress bar to display the totalMB/totalMB
		bar.tick({'title': displayTitle, 'stats': `${(videoSize/1024000).toFixed(0)}/${(videoSize/1024000).toFixed(0)}MB`})
		bar.terminate();
		videos[video.guid].partial = false;
    videos[video.guid].saved = true;
    saveVideoData();
		queueCount -= 1 // Reduce queueCount by 1
	// Write out the file to the partial file previously saved. But write with read+ and set the starting byte number (Where to start wiriting to the file from) to the previous amount transferred
	}).pipe(fs.createWriteStream(video.rawPath+video.title+'.mp4.part', fileOptions)).on('finish', function(){ // When done writing out the file
		fs.rename(video.rawPath+video.title+'.mp4.part', video.rawPath+video.title+'.mp4', function(){
			videos[video.guid].file = video.rawPath+video.title+'.mp4'; // Specifies where the video is saved
			saveVideoData();
			let temp_file = video.rawPath+'TEMP_'+video.title+'.mp4' // Specify the temp file to write the metadata to
			ffmpegFormat(temp_file, video) // Format with ffmpeg for titles/plex support
		}); // Rename it without .part
	});
}

const promptFloatplaneLogin = async () => {
	let user = await loopError(async () => fApi.auth.login(...Object.values(await prompts.floatplane.credentials())), async err => console.log('\nLooks like those login details didnt work, Please try again...'))

	if (user.needs2FA) {
		console.log(`Looks like you have 2Factor authentication enabled. Nice!\n`);
		user = await loopError(async () => await fApi.auth.factor(await prompts.floatplane.token()), async err => console.log('\nLooks like that 2Factor token didnt work, Please try again...'))
	}

	console.log(`\nSigned in as ${user.user.username}!\n`)
	auth.cookie = fApi.cookie
}

const promptPlexLogin = async () => {
	console.log('\nPlease enter your plex details. (Username and Password is not saved, only used to generate a token.)');
	const username = await prompts.plex.username()
	const password = await prompts.plex.password()
	plexApi = new PlexAPI({
		username, 
		password 
	})
	settings.plex.token = await new Promise((res, rej) => plexApi.authenticator.authenticate(plexApi, (err, token) => err?rej(err):res(token)))
	console.log(`Fetched plex token: ${settings.plex.token}\n`)
}

const promptPlexSections = async () => {
	settings.plex.sectionsToUpdate = (await prompts.plex.sections(settings.plex.sectionsToUpdate.join(", "))).splice(array.indexOf(""), 1)||settings.plex.sectionsToUpdate
	if (settings.plex.sectionsToUpdate.length === 0) {
		console.log(`You didnt specify any plex sections to update! Disabling plex integration...`)
		settings.plex.enabled = false
		return false
	}
}

const firstLaunch = async (settings, fApi) => {
	console.log(`Welcome to Floatplane Downloader! Thanks for checking it out <3.`)
	console.log(`According to your settings.json this is your first launch! So lets go through the basic setup...\n`)
	console.log(`\n== General ==\n`)

	settings.videoFolder = await prompts.settings.videoFolder(settings.videoFolder)||settings.videoFolder
	settings.floatplane.videosToSearch = await prompts.floatplane.videosToSearch(settings.floatplane.videosToSearch)||settings.floatplane.videosToSearch
	settings.downloadThreads = await prompts.settings.downloadThreads(settings.downloadThreads)||settings.downloadThreads
	settings.floatplane.videoResolution = await prompts.settings.videoResolution(settings.floatplane.videoResolution, defaults.resolutions)||settings.floatplane.videoResolution
	settings.fileFormatting = await prompts.settings.fileFormatting(settings.fileFormatting, settings._fileFormattingOPTIONS)||settings.fileFormatting

	const extras = await prompts.settings.extras(settings.extras)||settings.extras
	for (extra in settings.extras) settings.extras[extra] = extras.indexOf(extra) > -1?true:false

	settings.repeat.enabled = await prompts.settings.repeat(settings.repeat.enabled)||settings.repeat.enabled
	if (settings.repeat.enabled) settings.repeat.interval = await prompts.settings.repeatInterval(settings.repeat.interval)||settings.repeat.interval

	// Encrypt authentication db
	settings.auth.encrypt = await prompts.settings.encryptAuthDB(settings.auth.encrypt)||settings.auth.encrypt
	if (!settings.auth.encrypt) auth = new db('auth', null, settings.auth.encrypt?settings.auth.encryptionKey:null)

	console.log(`\n== Floatplane ==\n`)
	console.log(`Next we are going to login to floatplane...`)
	await promptFloatplaneLogin();

	// Prompt to find best edge server for downloading
	if (await prompts.findClosestServerNow()) settings.floatplane.edge = findClosestEdge(await fApi.api.edges()).hostname
	console.log(`Closest edge server found is: "${settings.floatplane.edge}"\n`)

	// Prompt & Set auto finding best edge server
	settings.floatplane.findClosestEdge = await prompts.settings.autoFindClosestServer(settings.floatplane.findClosestEdge)||settings.floatplane.findClosestEdge

	console.log(`\n== Plex ==\n`)
	settings.plex.enabled = await prompts.plex.usePlex(settings.plex.enabled)||settings.plex.enabled
	if (settings.plex.enabled) {
		if (await promptPlexSections()) {
			await promptPlexLogin()
			settings.plex.hostname = await prompts.plex.hostname(settings.plex.hostname)||settings.plex.hostname
			settings.plex.port = await prompts.plex.port(settings.plex.port)||settings.plex.port
		}
	}
}

// Async start
;(async () => {
	// Earlybird functions, these are run before script start and not run again if script repeating is enabled.
	if (settings.firstLaunch) await firstLaunch();
	settings.firstLaunch = false

	// Get Plex details of not saved
	if (settings.plex.enabled) {
		if (settings.plex.sectionsToUpdate.length === 0) {
			console.log(`You have plex integration enabled but no sections set for updating!`)
			await promptPlexSections()
		}
		if (!settings.plex.remote.hostname) {
			console.log(`You have plex integration enabled but have not specified a hostname!`)
			settings.plex.hostname = await prompts.plex.hostname(settings.plex.hostname)||settings.plex.hostname
		} if (!settings.plex.remote.port) {
			console.log(`You have plex integration enabled but have not specified a port!`)
			settings.plex.port = await prompts.plex.port(settings.plex.port)||settings.plex.port
		} if (!settings.plex.token) {
			console.log(`You have plex integration enabled but have not specified a token!`)
			await promptPlexLogin()
		}
	}

	// Get Floatplane credentials if not saved
	if (!auth.cookie) {
		console.log(`No floatplane cookies found! Please re-enter floatplane details...`)
		await promptFloatplaneLogin()
	}

	if (settings.repeat.enabled) {
		const interval = settings.repeat.interval.split(":").map(s => parseInt(s))
		console.log(`\u001b[41mRepeating every ${interval[0]}H, ${interval[1]}m, ${interval[2]}s...\u001b[0m`);
		await start(); // Run
		const SECS = interval[2]
		const MINS = 60*interval[1]
		const HRS = 60*60*interval[0]
		let remaining = SECS+MINS+HRS
		setInterval(async () => {
			if (remaining === false) return;
			remaining--
			if (remaining <= 0) {
				console.log(`Auto restarting...\n`)
				remaining = false
				await start();
				remaining = SECS+MINS+HRS
			} else if (remaining%10 === 0) console.log(`${~~(remaining/60/60%60)}H, ${~~(remaining/60%60)}m, ${remaining%60}s until restart...`);
		}, 1000)
	} else await start() // If settings.repeatScript is -1 then just run once
})().catch(err => {
	console.log(`An error occurred!`)
	console.log(err)
	process.exit(1)
})