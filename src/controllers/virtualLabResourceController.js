const axios = require("axios");
const mongoose = require("mongoose");
const { Subject, VirtualLabResource } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const SOURCE_SITE_URL = "https://fyp3d-view.onrender.com";
const SOURCE_LABEL = "fyp3d-view";
const LEGACY_CANVAS_SOURCE_LABEL = "threed-view";
const AR_SOURCE_LABEL = "supabase-ar-catalog";
const DEFAULT_THUMBNAIL_URL =
  "https://via.placeholder.com/640x360.png?text=EduTwin+Canvas";
let siteSyncInFlight = null;
let lastSiteSyncAt = 0;
let arSyncInFlight = null;
let lastArSyncAt = 0;
const SITE_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const AR_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const MIN_CANVAS_RESOURCE_REPLACE_COUNT = 10;

const STATIC_AR_MODEL_URLS = [
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter1_atco_hand_lens.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter2_microscope(1).glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter2_paramecium.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter2_structure_of_amoeba.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter3_animal_cell.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter3_mitochondria.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter3_nerve_cell_collection_of_thunthu.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter3_structure_of_cilia.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter4_female_reproductive_organs-x_section.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_Biology/chapter5_corona_covid-19_virus.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter2_anatomy_of_a_flower.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter2_chloroplast.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter5_anatomy_of_the_airways.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter5_beating-heart.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter5_digestive_system.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_10_biology/chapter5_types_of_human_teeth.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter1_kingfisher.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter2_microscope(2).glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter2_thermometer.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter3_oxygenated_hemoglobin_cells.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter3_pokeweed_antiviral_protein.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter4_dna.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter4_dna_helix_with_base_pairing_3d.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter5_free_pack_-_human_skeleton.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_11_biology/chapter5_hepatitis_b.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_12_biology/chapter5_liver_3d.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_chemistry/Chapter%202%20Figure%202.2%20Some%20common%20measuring%20devices%20found%20in%20a%20chemistry%20laboratory.glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_chemistry/Chapter%203%20Figure%203.12%20Cathode%20rays%20bend%20passing%20through%20electric%20fi%20eld..glb",
  "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/grade_9_chemistry/Chapter%203%20Figure%203.15%20The%20apparatus%20used%20by%20Millikan%20to%20determine%20the%20charge%20of%20an%20electron.glb",
];

const canonicalSubjectName = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (
    normalized === "math" ||
    normalized === "maths" ||
    normalized === "mathematics"
  ) {
    return "math";
  }
  if (
    normalized === "biology" ||
    normalized === "chemistry" ||
    normalized === "physics"
  ) {
    return normalized;
  }
  return normalized;
};

const subjectNameForDatabase = (canonical = "") => {
  if (canonical === "math") return "Math";
  if (canonical === "biology") return "Biology";
  if (canonical === "chemistry") return "Chemistry";
  if (canonical === "physics") return "Physics";
  return canonical
    ? canonical.charAt(0).toUpperCase() + canonical.slice(1)
    : "";
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
  decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const slugToTitle = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\.(?:html?|htm)$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const decodeUriSafely = (value = "") => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const extractArCatalogEntryFromUrl = (resourceUrl) => {
  const rawUrl = String(resourceUrl || "").trim();
  if (!rawUrl) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const pathMatch = parsed.pathname.match(
    /\/object\/public\/([^/]+)\/([^?#]+\.glb)$/i,
  );
  if (!pathMatch) {
    return null;
  }

  const bucketName = decodeUriSafely(pathMatch[1]);
  const fileName = decodeUriSafely(pathMatch[2])
    .replace(/\.glb$/i, "")
    .trim();

  const gradeMatch = bucketName.match(/grade[_-]?(\d+)/i);
  const subjectMatch = bucketName.match(
    /(biology|chemistry|physics|math|maths)/i,
  );
  const chapterMatch = fileName.match(/chapter[_\s-]?(\d+)/i);

  const gradeLevel = parseGradeLevel(gradeMatch ? gradeMatch[1] : null);
  const subject = canonicalSubjectName(subjectMatch ? subjectMatch[1] : "");

  if (!gradeLevel || !subject) {
    return null;
  }

  const topicSlug = fileName
    .replace(/^chapter[_\s-]?\d+[_\s-]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanedTitle = slugToTitle(topicSlug || fileName);
  const chapter = chapterMatch ? `Chapter ${chapterMatch[1]}` : "General";
  const title = cleanedTitle || "AR model";

  return {
    grade_level: gradeLevel,
    subject,
    chapter,
    topic: title,
    title,
    description: `${title} AR model for ${subjectNameForDatabase(subject)} ${chapter}`,
    resource_url: rawUrl,
  };
};

const escapeRegExp = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
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
    const normalizedInteraction = String(query.interaction_type)
      .trim()
      .toUpperCase();
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
      "/grade\\d+/(?:maths|chemistry|physics|biology)/chapter\\d+(?:/[^\"')`]+(?:\\.(?:html?|htm))?)?(?:\\?[^\"')`]+)?",
    "gi",
  );
  const relativeRegex =
    /\/grade\d+\/(?:maths|chemistry|physics|biology)\/chapter\d+(?:\/[^"')`]+(?:\.(?:html?|htm))?)?(?:\?[^"')`]+)?/gi;

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

const fetchCombinedSiteContent = async () => {
  const html = String(
    (await axios.get(SOURCE_SITE_URL, { timeout: 15000 })).data || "",
  );
  const contents = [html];

  const scriptSrcRegex = /<script\b[^>]*src=["']([^"']+\.js)["'][^>]*>/gi;
  const scriptUrls = new Set();
  let scriptMatch;
  while ((scriptMatch = scriptSrcRegex.exec(html))) {
    const src = decodeHtmlEntities(scriptMatch[1]).trim();
    if (!src) continue;
    scriptUrls.add(
      src.startsWith("http")
        ? src
        : `${SOURCE_SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`,
    );
  }

  for (const scriptUrl of scriptUrls) {
    try {
      const jsContent = String(
        (await axios.get(scriptUrl, { timeout: 15000 })).data || "",
      );
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

    const uniqueByUrl = new Map();
    for (const resource of extractedResources) {
      if (!resource?.resource_url) continue;
      uniqueByUrl.set(resource.resource_url, resource);
    }

    const dedupedResources = Array.from(uniqueByUrl.values());
    if (dedupedResources.length < MIN_CANVAS_RESOURCE_REPLACE_COUNT) {
      throw new Error(
        `Canvas replace aborted. Expected at least ${MIN_CANVAS_RESOURCE_REPLACE_COUNT} links, got ${dedupedResources.length}`,
      );
    }

    const removalFilter = {
      interaction_type: "CANVAS",
      $or: [
        {
          "parameters.source": {
            $in: [SOURCE_LABEL, LEGACY_CANVAS_SOURCE_LABEL],
          },
        },
        {
          resource_url:
            /https:\/\/(?:threed-view-for-final-year-project|fyp3d-view)\.onrender\.com\//i,
        },
      ],
    };

    const removedResult = await VirtualLabResource.deleteMany(removalFilter);
    let syncedCount = 0;

    for (const resourceData of dedupedResources) {
      const subjectDoc = await resolveSubjectDocument(
        resourceData.subject,
        resourceData.grade_level,
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
        },
      );

      syncedCount += 1;
    }

    lastSiteSyncAt = Date.now();

    return {
      removedCount: removedResult?.deletedCount || 0,
      syncedCount,
      discoveredCount: dedupedResources.length,
    };
  })()
    .catch((error) => {
      console.warn("Canvas site sync failed:", error.message);
      throw error;
    })
    .finally(() => {
      siteSyncInFlight = null;
    });

  return siteSyncInFlight;
};

const shouldRefreshFromSite = () =>
  Date.now() - lastSiteSyncAt > SITE_SYNC_INTERVAL_MS;

const shouldRefreshArCatalog = () =>
  Date.now() - lastArSyncAt > AR_SYNC_INTERVAL_MS;

const syncArResourcesFromCatalog = async () => {
  if (arSyncInFlight) {
    return arSyncInFlight;
  }

  arSyncInFlight = (async () => {
    for (const modelUrl of STATIC_AR_MODEL_URLS) {
      const resourceData = extractArCatalogEntryFromUrl(modelUrl);
      if (!resourceData) {
        continue;
      }

      const subjectDoc = await resolveSubjectDocument(
        resourceData.subject,
        resourceData.grade_level,
      );

      if (!subjectDoc) {
        continue;
      }

      await VirtualLabResource.findOneAndUpdate(
        {
          subject_id: subjectDoc._id,
          resource_url: resourceData.resource_url,
          interaction_type: "AR",
        },
        {
          subject_id: subjectDoc._id,
          grade_level: resourceData.grade_level,
          chapter: resourceData.chapter,
          topic: resourceData.topic,
          title: resourceData.title,
          description: resourceData.description,
          thumbnail_url: DEFAULT_THUMBNAIL_URL,
          interaction_type: "AR",
          resource_url: resourceData.resource_url,
          parameters: {
            source: AR_SOURCE_LABEL,
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
        },
      );
    }

    lastArSyncAt = Date.now();
  })()
    .catch((error) => {
      console.warn("AR catalog sync failed:", error.message);
    })
    .finally(() => {
      arSyncInFlight = null;
    });

  return arSyncInFlight;
};

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

    const requestedInteraction = String(req.query.interaction_type || "")
      .trim()
      .toUpperCase();
    const shouldForceRefresh = ["1", "true", "yes"].includes(
      String(req.query.refresh || "")
        .trim()
        .toLowerCase(),
    );
    const shouldSyncForSubjectGradeRequest = Boolean(
      req.query.subject || req.query.grade,
    );
    const shouldSyncForCanvasRequest =
      requestedInteraction === "CANVAS" || shouldSyncForSubjectGradeRequest;
    const shouldSyncForArRequest =
      requestedInteraction === "AR" || shouldSyncForSubjectGradeRequest;

    if (
      shouldSyncForCanvasRequest &&
      (shouldForceRefresh || shouldRefreshFromSite())
    ) {
      await syncCanvasResourcesFromSite();
    }

    if (
      shouldSyncForArRequest &&
      (shouldForceRefresh || shouldRefreshArCatalog())
    ) {
      await syncArResourcesFromCatalog();
    }

    const resources = await VirtualLabResource.find(filter).sort({
      created_at: -1,
    });

    if (resources.length === 0 && (req.query.subject || req.query.grade)) {
      await Promise.all([
        syncCanvasResourcesFromSite(),
        syncArResourcesFromCatalog(),
      ]);
      const refreshedResources = await VirtualLabResource.find(filter).sort({
        created_at: -1,
      });

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
      ...(req.body.grade_level !== undefined
        ? { grade_level: req.body.grade_level }
        : {}),
      ...(req.body.chapter ? { chapter: String(req.body.chapter).trim() } : {}),
      ...(req.body.topic ? { topic: String(req.body.topic).trim() } : {}),
      ...(req.body.title ? { title: String(req.body.title).trim() } : {}),
      ...(req.body.description ? { description: req.body.description } : {}),
      ...(req.body.thumbnail_url
        ? { thumbnail_url: req.body.thumbnail_url }
        : {}),
      ...(req.body.interaction_type
        ? { interaction_type: req.body.interaction_type }
        : {}),
      ...(req.body.resource_url ? { resource_url: req.body.resource_url } : {}),
      ...(req.body.parameters !== undefined
        ? { parameters: req.body.parameters }
        : {}),
    };

    const resource = await VirtualLabResource.findByIdAndUpdate(
      resourceId,
      payload,
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

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

const syncVirtualLabResourcesFromSite = async (req, res) => {
  try {
    const [canvasSummary] = await Promise.all([
      syncCanvasResourcesFromSite(),
      syncArResourcesFromCatalog(),
    ]);

    const filter = await buildResourceFilter(req.query || {});
    const resources =
      filter === null
        ? []
        : await VirtualLabResource.find(filter).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Virtual lab catalog synced from site",
      count: resources.length,
      canvas: canvasSummary || null,
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
  syncCanvasResourcesFromSite,
  syncVirtualLabResourcesFromSite,
};
