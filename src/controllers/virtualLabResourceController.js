const axios = require("axios");
const mongoose = require("mongoose");
const { Subject, VirtualLabResource } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const SOURCE_SITE_URL = "https://fyp3d-view.onrender.com";
const SOURCE_LABEL = "fyp3d-view";
const DEFAULT_THUMBNAIL_URL =
  "https://via.placeholder.com/640x360.png?text=EduTwin+Canvas";
let siteSyncInFlight = null;
let lastSiteSyncAt = 0;
const SITE_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const canonicalSubjectName = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "math" || normalized === "maths" || normalized === "mathematics") {
    return "math";
  }
  if (normalized === "biology" || normalized === "chemistry" || normalized === "physics") {
    return normalized;
  }
  return normalized;
};

const subjectNameForDatabase = (canonical = "") => {
  if (canonical === "math") return "Math";
  if (canonical === "biology") return "Biology";
  if (canonical === "chemistry") return "Chemistry";
  if (canonical === "physics") return "Physics";
  return canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "";
};

const parseGradeLevel = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
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

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveSubjectDocument = async (subject, gradeLevel) => {
  const canonical = canonicalSubjectName(subject);
  const resolvedGrade = parseGradeLevel(gradeLevel);
  if (!canonical || !resolvedGrade) {
    return null;
  }

  const dbSubjectName = subjectNameForDatabase(canonical);
  return Subject.findOneAndUpdate(
    { name: dbSubjectName, grade_level: resolvedGrade },
    { name: dbSubjectName, grade_level: resolvedGrade },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
};

const serializeVirtualLabResource = (resource) => ({
  id: String(resource._id),
  subject:
    canonicalSubjectName(resource?.parameters?.subject || "") ||
    canonicalSubjectName(resource?.subject || "") ||
    "",
  grade: parseGradeLevel(resource?.grade_level) || null,
  chapter: resource.chapter,
  topic: resource.topic,
  title: resource.title,
  type: String(resource.interaction_type || "CANVAS").toLowerCase(),
  url: resource.resource_url,
  page: null,
});

const buildResourceFilter = async (query = {}) => {
  const filter = {};

  if (query.subject_id && isValidId(query.subject_id)) {
    filter.subject_id = query.subject_id;
  } else if (query.subject || query.grade) {
    const subjectDoc = await resolveSubjectDocument(query.subject, query.grade);
    if (!subjectDoc) {
      return null;
    }
    filter.subject_id = subjectDoc._id;
  }

  if (query.interaction_type) {
    const normalizedInteraction = String(query.interaction_type).trim().toUpperCase();
    if (normalizedInteraction === "CANVAS" || normalizedInteraction === "AR") {
      filter.interaction_type = normalizedInteraction;
    }
  }

  if (query.chapter) {
    filter.chapter = new RegExp(String(query.chapter).trim(), "i");
  }

  return filter;
};

const extractCanvasResourcesFromHtml = (html) => {
  const resources = [];
  const sourceHost = new URL(SOURCE_SITE_URL).host;
  const absoluteRegex = new RegExp(
    "https://" +
      escapeRegExp(sourceHost) +
      "/grade\\d+/(?:maths|chemistry|physics|biology)/chapter\\d+(?:/[^\"'\\s)`]+(?:\\.(?:html?|htm))?)?(?:\\?[^\"'\\s)`]+)?",
    "gi"
  );
  const relativeRegex = /\/grade\d+\/(?:maths|chemistry|physics|biology)\/chapter\d+(?:\/[^"'\s)`]+(?:\.(?:html?|htm))?)?(?:\?[^"'\s)`]+)?/gi;

  const discoveredUrls = new Set();
  for (const hit of String(html || "").match(absoluteRegex) || []) {
    discoveredUrls.add(hit);
  }
  for (const hit of String(html || "").match(relativeRegex) || []) {
    discoveredUrls.add(`${SOURCE_SITE_URL}${hit}`);
  }

  for (const resolvedUrl of discoveredUrls) {
    let parsedUrl;
    try {
      parsedUrl = new URL(resolvedUrl);
    } catch {
      continue;
    }

    const pathMatch = parsedUrl.pathname.match(
      /\/grade(\d+)\/([^/]+)\/chapter(\d+)(?:\/([^/?#]+))?\/?$/i
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
          `/${normalizedFileName || "model"}.html`
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

const fetchCombinedSiteContent = async () => {
  const html = String((await axios.get(SOURCE_SITE_URL, { timeout: 15000 })).data || "");
  const contents = [html];

  const scriptSrcRegex = /<script\b[^>]*src=["']([^"']+\.js)["'][^>]*>/gi;
  const scriptUrls = new Set();
  let scriptMatch;
  while ((scriptMatch = scriptSrcRegex.exec(html))) {
    const src = decodeHtmlEntities(scriptMatch[1]).trim();
    if (!src) continue;
    scriptUrls.add(src.startsWith("http") ? src : `${SOURCE_SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`);
  }

  for (const scriptUrl of scriptUrls) {
    try {
      const jsContent = String((await axios.get(scriptUrl, { timeout: 15000 })).data || "");
      contents.push(jsContent);
    } catch {
      // Ignore one failing chunk and keep scanning remaining script files.
    }
  }

  return contents.join("\n");
};

const syncCanvasResourcesFromSite = async () => {
  if (siteSyncInFlight) {
    return siteSyncInFlight;
  }

  siteSyncInFlight = (async () => {
    const siteContent = await fetchCombinedSiteContent();
    const extractedResources = extractCanvasResourcesFromHtml(siteContent);

    for (const resourceData of extractedResources) {
      const subjectDoc = await resolveSubjectDocument(
        resourceData.subject,
        resourceData.grade_level
      );

      if (!subjectDoc) {
        continue;
      }

      await VirtualLabResource.findOneAndUpdate(
        {
          subject_id: subjectDoc._id,
          resource_url: resourceData.resource_url,
          interaction_type: "CANVAS",
        },
        {
          subject_id: subjectDoc._id,
          grade_level: resourceData.grade_level,
          chapter: resourceData.chapter,
          topic: resourceData.topic,
          title: resourceData.title,
          description: resourceData.description,
          thumbnail_url: DEFAULT_THUMBNAIL_URL,
          interaction_type: "CANVAS",
          resource_url: resourceData.resource_url,
          parameters: {
            source: SOURCE_LABEL,
            subject: resourceData.subject,
            chapter: resourceData.chapter,
            topic: resourceData.topic,
            grade_level: resourceData.grade_level,
          },
          created_at: new Date(),
        },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
          runValidators: true,
        }
      );
    }

    lastSiteSyncAt = Date.now();
  })()
    .catch((error) => {
      console.warn("Canvas site sync failed:", error.message);
    })
    .finally(() => {
      siteSyncInFlight = null;
    });

  return siteSyncInFlight;
};

const shouldRefreshFromSite = () => Date.now() - lastSiteSyncAt > SITE_SYNC_INTERVAL_MS;

const createVirtualLabResource = async (req, res) => {
  try {
    const {
      subject_id,
      grade_level,
      chapter,
      topic,
      title,
      description,
      thumbnail_url,
      interaction_type,
      resource_url,
      parameters,
    } = req.body;

    if (
      !subject_id ||
      !grade_level ||
      !chapter ||
      !topic ||
      !title ||
      !description ||
      !thumbnail_url ||
      !interaction_type ||
      !resource_url
    ) {
      return res.status(400).json({
        success: false,
        message:
          "subject_id, grade_level, chapter, topic, title, description, thumbnail_url, interaction_type, and resource_url are required",
      });
    }

    const resource = await VirtualLabResource.create({
      subject_id,
      grade_level,
      chapter: String(chapter).trim(),
      topic: String(topic).trim(),
      title: String(title).trim(),
      description,
      thumbnail_url,
      interaction_type,
      resource_url,
      parameters: parameters || null,
      created_at: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Virtual lab resource created",
      data: resource,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create virtual lab resource",
      error: error.message,
    });
  }
};

const getVirtualLabResources = async (req, res) => {
  try {
    const filter = await buildResourceFilter(req.query);
    if (filter === null) {
      return res.status(200).json({
        success: true,
        resources: [],
        data: [],
      });
    }

    const requestedInteraction = String(req.query.interaction_type || "").trim().toUpperCase();
    const shouldSyncForCanvasRequest =
      requestedInteraction === "CANVAS" || req.query.subject || req.query.grade;

    if (shouldSyncForCanvasRequest && shouldRefreshFromSite()) {
      await syncCanvasResourcesFromSite();
    }

    const resources = await VirtualLabResource.find(filter).sort({ created_at: -1 });

    if (resources.length === 0 && (req.query.subject || req.query.grade)) {
      await syncCanvasResourcesFromSite();
      const refreshedResources = await VirtualLabResource.find(filter).sort({ created_at: -1 });

      return res.status(200).json({
        success: true,
        resources: refreshedResources.map(serializeVirtualLabResource),
        data: refreshedResources,
      });
    }

    return res.status(200).json({
      success: true,
      resources: resources.map(serializeVirtualLabResource),
      data: resources,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch virtual lab resources",
      error: error.message,
    });
  }
};

const getVirtualLabResourceById = async (req, res) => {
  try {
    const { resourceId } = req.params;

    if (!isValidId(resourceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource id",
      });
    }

    const resource = await VirtualLabResource.findById(resourceId);
    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Virtual lab resource not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: resource,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch virtual lab resource",
      error: error.message,
    });
  }
};

const updateVirtualLabResource = async (req, res) => {
  try {
    const { resourceId } = req.params;

    if (!isValidId(resourceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource id",
      });
    }

    const payload = {
      ...(req.body.subject_id ? { subject_id: req.body.subject_id } : {}),
      ...(req.body.grade_level !== undefined ? { grade_level: req.body.grade_level } : {}),
      ...(req.body.chapter ? { chapter: String(req.body.chapter).trim() } : {}),
      ...(req.body.topic ? { topic: String(req.body.topic).trim() } : {}),
      ...(req.body.title ? { title: String(req.body.title).trim() } : {}),
      ...(req.body.description ? { description: req.body.description } : {}),
      ...(req.body.thumbnail_url ? { thumbnail_url: req.body.thumbnail_url } : {}),
      ...(req.body.interaction_type ? { interaction_type: req.body.interaction_type } : {}),
      ...(req.body.resource_url ? { resource_url: req.body.resource_url } : {}),
      ...(req.body.parameters !== undefined ? { parameters: req.body.parameters } : {}),
    };

    const resource = await VirtualLabResource.findByIdAndUpdate(resourceId, payload, {
      returnDocument: "after",
      runValidators: true,
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Virtual lab resource not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Virtual lab resource updated",
      data: resource,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update virtual lab resource",
      error: error.message,
    });
  }
};

const syncVirtualLabResourcesFromSite = async (_req, res) => {
  try {
    await syncCanvasResourcesFromSite();

    const filter = await buildResourceFilter(req.query || {});
    const resources = filter === null
      ? []
      : await VirtualLabResource.find(filter).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Virtual lab catalog synced from site",
      count: resources.length,
      resources: resources.map(serializeVirtualLabResource),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to sync virtual lab catalog",
      error: error.message,
    });
  }
};

const deleteVirtualLabResource = async (req, res) => {
  try {
    const { resourceId } = req.params;

    if (!isValidId(resourceId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid resource id",
      });
    }

    const resource = await VirtualLabResource.findByIdAndDelete(resourceId);
    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Virtual lab resource not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Virtual lab resource deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete virtual lab resource",
      error: error.message,
    });
  }
};

module.exports = {
  createVirtualLabResource,
  getVirtualLabResources,
  getVirtualLabResourceById,
  updateVirtualLabResource,
  deleteVirtualLabResource,
  syncVirtualLabResourcesFromSite,
};
