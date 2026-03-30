const mongoose = require("mongoose");
const { VirtualLabResource } = require("../models");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const createVirtualLabResource = async (req, res) => {
  try {
    const {
      subject_id,
      title,
      description,
      thumbnail_url,
      interaction_type,
      resource_url,
      parameters,
    } = req.body;

    if (!subject_id || !title || !description || !thumbnail_url || !interaction_type || !resource_url) {
      return res.status(400).json({
        success: false,
        message:
          "subject_id, title, description, thumbnail_url, interaction_type, and resource_url are required",
      });
    }

    const resource = await VirtualLabResource.create({
      subject_id,
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
    const { subject_id, interaction_type } = req.query;

    const filter = {};
    if (subject_id) filter.subject_id = subject_id;
    if (interaction_type) filter.interaction_type = interaction_type;

    const resources = await VirtualLabResource.find(filter).sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
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
      ...(req.body.title ? { title: String(req.body.title).trim() } : {}),
      ...(req.body.description ? { description: req.body.description } : {}),
      ...(req.body.thumbnail_url ? { thumbnail_url: req.body.thumbnail_url } : {}),
      ...(req.body.interaction_type ? { interaction_type: req.body.interaction_type } : {}),
      ...(req.body.resource_url ? { resource_url: req.body.resource_url } : {}),
      ...(req.body.parameters !== undefined ? { parameters: req.body.parameters } : {}),
    };

    const resource = await VirtualLabResource.findByIdAndUpdate(resourceId, payload, {
      new: true,
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
};
