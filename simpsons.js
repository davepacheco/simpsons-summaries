var mod_html = require('./node-htmlparser');
var mod_http = require('http');
var mod_sys = require('sys');
var mod_fs = require('fs');
var ASSERT = require('assert').ok;

/*
 * Configuration parameters for connecting to the SNPP site
 */
var snpp_config = {
	port: 80,
	host: 'snpp.com',
	uribase: '/episodeguide/season',
	urisfx: '.html',
};

var dowrite = false;

/*
 * Base directory for our own Simpsons media files.
 */
var basedir = '/export/media/Videos/The Simpsons';

/*
 * Interface for crawling SNPP.  'conf' has the form used above in snpp_config.
 */
function SnppCrawler(conf)
{
	this.sc_conf = conf;
}

/*
 * Iterate the episodes of the specified season.  "itercb" is invoked for each
 * episode with an object having fields for season, episode number, title, aired
 * (date), and description.  "donecb" is invoked when the walk completes with a
 * non-null argument representing any errors that occurred (if any).
 */
SnppCrawler.prototype.walkEpisodes = function (season, itercb, donecb)
{
	var snpp = this;

	this.downloadSeason(season, function (err, data) {
		if (err)
			return (donecb(err));

		return (snpp.walkSeasonData(data, itercb, donecb));
	    });
};

/*
 * [private] Downloads the SNPP page for a particular season and invokes
 * "callback" with the usual error/result arguments where "result" is the DOM
 * representation of the page (as output by the HTML parser, not the standard
 * DOM representation).
 */
SnppCrawler.prototype.downloadSeason = function (season, callback)
{
	var snpp = this;
	var client, uri, request;

	uri = this.sc_conf.uribase + season + this.sc_conf.urisfx;
	client = mod_http.createClient(this.sc_conf.port, this.sc_conf.host);
	request = client.request('GET', uri, { 'Host': 'snpp.com' });
	request.end();
	request.on('response', function (response) {
		var data = '';

		if (response.statusCode != 200)
			return (callback(new Error('server returned ' +
			    response.statusCode), null));

		response.on('data', function (chunk) { data += chunk; });
		response.on('end', function () {
			return (snpp.processSeason(season, data, callback));
		});
	});
};

/*
 * [private] Continues the work of downloadSeason.  Given the HTML
 * representation of the page, parses it and invokes "callback" with the result.
 */
SnppCrawler.prototype.processSeason = function (season, data, callback)
{
	var snpp = this;
	var handler, parser;

	handler = new mod_html.DefaultHandler(function (error, dom) {
		if (error)
			return (callback(new Error(error), null));

		return (snpp.finishSeason(season, dom, callback));
	});

	parser = new mod_html.Parser(handler);
	parser.parseComplete(data);
};

/*
 * [private] Finish the work of downloadSeason and processSeason.  Given the JS
 * representation of the HTML page, extract the relevant pieces.
 */
SnppCrawler.prototype.finishSeason = function (season, dom, callback)
{
	var episodes = [];
	var node, episode, pp, tt, tr1, tr2, nn, ii, jj;
	var text;
	var findchild, findtext, flatten, trim;

	findchild = function (fnode, name, start) {
		var kk;

		for (kk = start || 0; kk < fnode.children.length; kk++) {
			if (fnode.children[kk].name == name)
				return (fnode.children[kk]);
		}

		return (undefined);
	};

	findtext = function (fnode, start) {
		var kk;

		for (kk = start || 0; kk < fnode.children.length; kk++) {
			if (fnode.children[kk].type == 'text')
				break;
		}

		if (kk == fnode.children.length)
			return ('');

		return (trim(fnode.children[kk].data));
	}

	trim = function (text) {
		var kk;

		text = text.replace(/\n/g, '');
		text = text.replace(/ {2,}/g, ' ');
		text = text.replace(/&amp;?/g, '&');
		text = text.replace(/&quot;/g, '"');
		text = text.replace(/&#147;/g, '"');
		text = text.replace(/&#148;/g, '"');

		for (kk = 0; kk < text.length; kk++) {
			if (text[kk] != ' ')
				break;
		}

		text = text.substring(kk);

		for (kk = text.length - 1; kk > 0; kk--) {
			if (text[kk] != ' ')
				break;
		}

		text = text.substring(0, kk + 1);
		return (text);
	};

	flatten = function (fnode) {
		var kk, texts;

		if (fnode.type == 'text')
			return (trim(fnode.data));

		if (!fnode.children)
			return ('');

		texts = fnode.children.map(function (cnode) {
			return (flatten(cnode));
		});

		return (texts.join(' '));
	};

	node = dom[0];
	ASSERT(node.name == 'html');
	node = findchild(node, 'body');

	for (ii = 0; ii < node.children.length; ii++) {
		episode = {};
		episode.season = season;

		// console.log(node.children[ii]);

		/*
		 * Most episodes are described inside a table inside a 'p' tag.
		 */
		pp = node.children[ii];
		if (pp.name != 'p') {
		//	console.log('skipping: not a P');
			continue;
		}

		tt = findchild(pp, 'table');
		tr1 = findchild(tt, 'tr', 1);
		tr2 = findchild(tt, 'tr', 2);

		if (!tr2) {
		//	console.log('skipping: no second TR');
			continue;
		}

		nn = findchild(tr1, 'td');
		nn = findchild(nn, 'font');
		if (!nn) {
			/* Season 12: HOMR has an image here instead. */
			node = pp;
			ii = -1;
		//	console.log('skipping: no FONT');
			continue;
		}
		nn = findchild(nn, 'b');
		if (!nn) {
		//	console.log('skipping: no B');
			continue;
		}
		text = findtext(nn);
		text = text.substring(text.indexOf('(') + 1,
		    text.indexOf(')') - text.indexOf('(')); /* XXX */
		episode.number = text;

		nn = findchild(nn, 'a');
		text = findtext(nn);
		episode.title = text;
		console.log('found %s', text);

		nn = findchild(tr1, 'td', 1);
		nn = findchild(nn, 'font');
		nn = findchild(nn, 'b');
		text = findtext(nn);
		episode.aired = text;

		nn = findchild(tr2, 'td', 1);
		text = flatten(nn);
		episode.description = text;

		/*
		 * These 'p' tags are actually children in the DOM hierarchy but
		 * they lack closing 'p' tags and the parser treats them like
		 * children.
		 */
		episodes.push(episode);
		if (pp.name == 'p') {
			node = pp;
			ii = -1;
		}
	}

	callback(null, episodes);
};

/*
 * [private] Iterate the episodes of the given season as described by
 * walkEpisodes.
 */
SnppCrawler.prototype.walkSeasonData = function (season, itercb, donecb)
{
	var ii;

	for (ii = 0; ii < season.length; ii++)
		itercb(season[ii]);

	donecb(null);
};

var count = 0;

/*
 * report/listEpisode/listDone use SnppCrawler.walkEpisodes to print the data.
 */
function report(snpp, seasons)
{
	var ii;

	for (ii = 0; ii < seasons.length; ii++)
		snpp.walkEpisodes(seasons[ii], listEpisode, listDone);
}

function listEpisode(episode)
{
	count++;
	console.log('SEASON %s EPISODE %s: "%s" (aired %s)',
	    episode.season, episode.number, episode.title, episode.aired);
	console.log(episode.description);
	console.log('-----------------------------------------');
}

function listDone(err)
{
	if (err)
		throw (err);

	console.log('%s total episodes', count);
}

/*
 * save/iterEpisode/iterDone use SnppCrawler.walkEpisodes to actually save the
 * metadata for each episode.
 */
function save(snpp, seasons)
{
	var ii;

	for (ii = 0; ii < seasons.length; ii++)
		snpp.walkEpisodes(seasons[ii], iterEpisode, iterDone);
}

function iterEpisode(episode)
{
	var dir, season, epwordkey, epwords, ii, jj;

	count++;

	epwords = episode.title.split(/\s+/).map(function (word) {
		return (word.toLowerCase());
	});

	epwordkey = {};
	for (ii = 0; ii < epwords.length; ii++) {
		if (epwords[ii] == 'of' ||
		    epwords[ii] == 'the' ||
		    epwords[ii] == 'and')
			continue;
		epwordkey[epwords[ii]] = true;
	}

	season = episode.season;
	if (season < 10)
		season = '0' + season;
	dir = basedir + '/Season ' + season;
	mod_fs.readdir(dir, function (err, files) {
		var count, maxcount, maxfile;
		var fiwords;

		if (err)
			throw (err);

		for (ii = 0; ii < files.length; ii++) {
			count = 0;

			if (files[ii].indexOf('.txt') != -1)
				continue;

			fiwords = files[ii].replace(/.m4v/, '').split(/\s+/);
			for (jj = 0; jj < fiwords.length; jj++) {
				if (fiwords[jj].toLowerCase() in epwordkey)
					count++;
			}

			if (maxcount === undefined || count > maxcount) {
				maxcount = count;
				maxfile = files[ii];
			}
		}

		if (maxfile.substring(5).toLowerCase() ==
		    episode.title.toLowerCase() + '.m4v') {
			console.log('definite match for "%s"', episode.title);
			writeMetadata(dir, maxfile + '.txt', episode);
		} else if (maxcount > 0) {
			console.log('%d "%s" looks like "%s"',
			    maxcount, episode.title, maxfile);
			writeMetadata(dir, maxfile + '.txt', episode);
		} else {
			console.log("don't know what to do with %s",
			    episode.title);
		}
	});
}

function writeMetadata(dir, file, episode)
{
	if (!dowrite)
		return;

	var path = dir + '/' + file;
	var content = episode.number + ': ' + episode.title + 
	    ' (aired ' + episode.aired + ')\n\n' + episode.description + '\n';
	var buffer = new Buffer(content);

	mod_fs.open(path, 'w', 0666, function (err, fd) {
		if (err) {
			console.log('error creating %s: %s', path, err);
			return;
		}

		mod_fs.write(fd, buffer, 0, content.length, 0,
		    function (err, written) {
			if (err) {
				console.log('error writing to %s: %s',
				    path, err);
				return;
			}

			if (written != content.length) {
				console.log('short write to %s: %s of %s bytes',
				    path, written, content.length);
				return;
			}

			console.log('wrote out %s', path);
		    });
	});
}

function iterDone(err)
{
	if (err)
		throw (err);
}

function main()
{
	var snpp = new SnppCrawler(snpp_config);
	// var seasons = [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 ]
	var seasons = [ 12 ]
	save(snpp, seasons);
}

main();
