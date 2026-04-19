const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const connectDatabase = require("../config/database");
const { Subject, VirtualLabResource } = require("../models");

const SOURCE_SITE_URL = "https://fyp3d-view.onrender.com";
const SOURCE_LABEL = "fyp3d-view";
const DEFAULT_THUMBNAIL_URL =
	"https://via.placeholder.com/640x360.png?text=EduTwin+Canvas";
const OUTPUT_CATALOG_PATH = path.resolve(__dirname, "../../../samples/grade9_canvas_catalog.json");

const canonicalSubjectName = (value = "") => {
	const normalized = String(value || "").trim().toLowerCase();
	if (normalized === "math" || normalized === "maths" || normalized === "mathematics") {
		return "math";
	}
	if (normalized === "biology" || normalized === "chemistry" || normalized === "physics") {
		return normalized;
	}
	return "";
};

const subjectNameForDatabase = (canonical = "") => {
	if (canonical === "math") return "Math";
	if (canonical === "biology") return "Biology";
	if (canonical === "chemistry") return "Chemistry";
	if (canonical === "physics") return "Physics";
	return canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "";
};

const decodeHtmlEntities = (value = "") =>
	String(value)
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");

const stripHtml = (value = "") =>
	decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const slugToTitle = (value = "") =>
	String(value || "")
		.replace(/[_-]+/g, " ")
		.replace(/\.(?:html?|htm)$/i, "")
		.replace(/\s+/g, " ")
		.trim();

const parseGradeLevel = (value) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractCanvasUrlsFromContent = (content) => {
	const found = new Set();
	const sourceHost = new URL(SOURCE_SITE_URL).host;
	const absoluteRegex = new RegExp(
		"https://" +
			escapeRegExp(sourceHost) +
			"/grade\\d+/(?:maths|chemistry|physics|biology)/chapter\\d+(?:/[^\"'\\s)`]+(?:\\.(?:html?|htm))?)?(?:\\?[^\"'\\s)`]+)?",
		"gi",
	);
	const relativeRegex = /\/grade\d+\/(?:maths|chemistry|physics|biology)\/chapter\d+(?:\/[^"'\s)`]+(?:\.(?:html?|htm))?)?(?:\?[^"'\s)`]+)?/gi;

	for (const match of String(content || "").match(absoluteRegex) || []) {
		found.add(match);
	}

	for (const match of String(content || "").match(relativeRegex) || []) {
		found.add(`${SOURCE_SITE_URL}${match}`);
	}

	return Array.from(found);
};

const fetchCanvasUrlsFromSite = async () => {
	const html = String((await axios.get(SOURCE_SITE_URL, { timeout: 15000 })).data || "");
	const scriptSrcRegex = /<script\b[^>]*src=["']([^"']+\.js)["'][^>]*>/gi;
	const scriptUrls = new Set();
	let match;

	while ((match = scriptSrcRegex.exec(html))) {
		const src = decodeHtmlEntities(match[1]).trim();
		if (!src) continue;
		scriptUrls.add(src.startsWith("http") ? src : `${SOURCE_SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`);
	}

	const contents = [html];
	for (const scriptUrl of scriptUrls) {
		try {
			const js = String((await axios.get(scriptUrl, { timeout: 15000 })).data || "");
			contents.push(js);
		} catch {
			// Ignore one-off bundle fetch failures and continue with remaining files.
		}
	}

	return extractCanvasUrlsFromContent(contents.join("\n"));
};

const extractCanvasResourcesFromUrls = (urls) => {
	const resources = [];

	for (const resolvedUrl of urls) {
		let parsedUrl;
		try {
			parsedUrl = new URL(resolvedUrl);
		} catch {
			continue;
		}

		const pathMatch = parsedUrl.pathname.match(
			/\/grade(\d+)\/([^/]+)\/chapter(\d+)(?:\/([^/?#]+))?\/?$/i,
		);

		if (!pathMatch) {
			continue;
		}

		const gradeLevel = parseGradeLevel(pathMatch[1]);
		const subjectKey = canonicalSubjectName(pathMatch[2]);
		const chapterNumber = pathMatch[3];
		const rawFileName = String(pathMatch[4] || "").trim();
		const hasFileName = Boolean(rawFileName);
		const normalizedFileName = rawFileName
			.replace(/\.(?:html?|htm)$/i, "")
			.replace(/[._-]+$/g, "")
			.trim();

		const normalizedPath = hasFileName
			? parsedUrl.pathname.replace(
				/\/([^/]+)\/?$/,
				`/${normalizedFileName || "model"}.html`,
			)
			: parsedUrl.pathname.endsWith("/")
				? parsedUrl.pathname
				: `${parsedUrl.pathname}/`;

		const normalizedUrl = `${parsedUrl.origin}${normalizedPath}`;
		const title = hasFileName
			? slugToTitle(normalizedFileName)
			: `Chapter ${chapterNumber} Models`;

		if (!gradeLevel || !subjectKey || !title) {
			continue;
		}

		resources.push({
			grade_level: gradeLevel,
			subject: subjectKey,
			chapter: `Chapter ${chapterNumber}`,
			topic: title,
			title,
			description: `${title} from ${subjectNameForDatabase(subjectKey)} Chapter ${chapterNumber}`,
			resource_url: normalizedUrl,
		});
	}

	return resources;
};

const buildStructuredCatalog = (resources) => {
	const catalog = {
		source: SOURCE_SITE_URL,
		generated_at: new Date().toISOString(),
		grades: {},
	};

	for (const resource of resources) {
		const gradeKey = `Grade ${resource.grade_level}`;
		const subjectLabel = subjectNameForDatabase(resource.subject);
		const chapterKey = resource.chapter;

		if (!catalog.grades[gradeKey]) {
			catalog.grades[gradeKey] = { subjects: {} };
		}

		if (!catalog.grades[gradeKey].subjects[subjectLabel]) {
			catalog.grades[gradeKey].subjects[subjectLabel] = { chapters: {} };
		}

		if (!catalog.grades[gradeKey].subjects[subjectLabel].chapters[chapterKey]) {
			catalog.grades[gradeKey].subjects[subjectLabel].chapters[chapterKey] = [];
		}

		catalog.grades[gradeKey].subjects[subjectLabel].chapters[chapterKey].push({
			title: resource.title,
			topic: resource.topic,
			url: resource.resource_url,
			interaction_type: "CANVAS",
		});
	}

	return catalog;
};

const seed = async () => {
	await connectDatabase();

	const urls = await fetchCanvasUrlsFromSite();
	const resources = extractCanvasResourcesFromUrls(urls);
	const structuredCatalog = buildStructuredCatalog(resources);
	await fs.writeFile(OUTPUT_CATALOG_PATH, JSON.stringify(structuredCatalog, null, 2), "utf8");

	const removed = await VirtualLabResource.deleteMany({
		interaction_type: "CANVAS",
		$or: [
			{ "parameters.source": { $in: ["threed-view", SOURCE_LABEL] } },
			{ resource_url: /https:\/\/(?:threed-view-for-final-year-project|fyp3d-view)\.onrender\.com\//i },
		],
	});

	let syncedCount = 0;

	for (const resource of resources) {
		const subjectDoc = await Subject.findOneAndUpdate(
			{ name: subjectNameForDatabase(resource.subject), grade_level: resource.grade_level },
			{ name: subjectNameForDatabase(resource.subject), grade_level: resource.grade_level },
			{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
		);

		if (!subjectDoc) {
			continue;
		}

		await VirtualLabResource.findOneAndUpdate(
			{
				subject_id: subjectDoc._id,
				resource_url: resource.resource_url,
				interaction_type: "CANVAS",
			},
			{
				subject_id: subjectDoc._id,
				grade_level: resource.grade_level,
				chapter: resource.chapter,
				topic: resource.topic,
				title: resource.title,
				description: resource.description,
				thumbnail_url: DEFAULT_THUMBNAIL_URL,
				interaction_type: "CANVAS",
				resource_url: resource.resource_url,
				parameters: {
					source: SOURCE_LABEL,
					subject: resource.subject,
					chapter: resource.chapter,
					topic: resource.topic,
					grade_level: resource.grade_level,
				},
				created_at: new Date(),
			},
			{
				upsert: true,
				returnDocument: "after",
				setDefaultsOnInsert: true,
				runValidators: true,
			},
		);

		syncedCount += 1;
	}

	console.log(`Removed ${removed.deletedCount || 0} existing site canvas links`);
	console.log(`Synced ${syncedCount} canvas resources from ${SOURCE_SITE_URL}`);
	console.log(`Wrote structured catalog to ${OUTPUT_CATALOG_PATH}`);
	process.exit(0);
};

seed().catch((error) => {
	console.error("Failed to seed virtual lab resources:", error.message);
	process.exit(1);
});
