const express = require("express")
const { body, validationResult } = require("express-validator")
const Document = require("../models/Document")
const User = require("../models/User")
const Notification = require("../models/Notification")
const { protect } = require("../middleware/auth")
const jwt = require("jsonwebtoken") // Import jwt

const router = express.Router()

// Helper function to extract mentions from content
const extractMentions =(content)=> {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return [...new Set(mentions)]; // Remove duplicates
}

// Helper function to check document access
const checkDocumentAccess = async (documentId, userId, requiredPermission = "view") => {
  const document = await Document.findById(documentId).populate("author", "name email")

  if (!document || document.isDeleted) {
    return { hasAccess: false, document: null }
  }

  // Author has full access
  if (document.author._id.toString() === userId.toString()) {
    return { hasAccess: true, document, permission: "edit" }
  }

  // Public documents are viewable by anyone
  if (document.visibility === "public" && requiredPermission === "view") {
    return { hasAccess: true, document, permission: "view" }
  }

  // Check shared access
  const sharedAccess = document.sharedWith.find((share) => share.user.toString() === userId.toString())

  if (sharedAccess) {
    const hasRequiredPermission =
      requiredPermission === "view" || (requiredPermission === "edit" && sharedAccess.permission === "edit")

    return {
      hasAccess: hasRequiredPermission,
      document,
      permission: sharedAccess.permission,
    }
  }

  return { hasAccess: false, document }
}

// @route   GET /api/documents
// @desc    Get all accessible documents
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query
    const userId = req.user.id

    const query = {
      isDeleted: false,
      $or: [{ author: userId }, { visibility: "public" }, { "sharedWith.user": userId }],
    }

    // Add search functionality
    if (search) {
      query.$text = { $search: search }
    }

    const documents = await Document.find(query)
      .populate("author", "name email")
      .populate("sharedWith.user", "name email")
      .sort({ lastModified: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Document.countDocuments(query)

    res.json({
      success: true,
      documents,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    })
  } catch (error) {
    console.error("Get documents error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   GET /api/documents/:id
// @desc    Get single document
// @access  Public (for public docs) / Private (for private docs)
router.get("/:id", async (req, res) => {
  try {
    const documentId = req.params.id
    let userId = null

    // Check if user is authenticated
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      try {
        const token = req.headers.authorization.split(" ")[1]
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(decoded.id)
        if (user) userId = user._id
      } catch (error) {
        // Token invalid, continue as unauthenticated user
      }
    }

    const document = await Document.findById(documentId)
      .populate("author", "name email")
      .populate("sharedWith.user", "name email")

    if (!document || document.isDeleted) {
      return res.status(404).json({ message: "Document not found" })
    }

    // Public documents are accessible to everyone
    if (document.visibility === "public") {
      return res.json({ success: true, document })
    }

    // Private documents require authentication and access
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" })
    }

    const { hasAccess } = await checkDocumentAccess(documentId, userId)

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" })
    }

    res.json({ success: true, document })
  } catch (error) {
    console.error("Get document error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   POST /api/documents
// @desc    Create new document
// @access  Private
router.post(
  "/",
  protect,
  [
    body("title").trim().isLength({ min: 1 }).withMessage("Title is required"),
    body("content").trim().isLength({ min: 1 }).withMessage("Content is required"),
    body("visibility").optional().isIn(["public", "private"]).withMessage("Invalid visibility option"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      const { title, content, visibility = "private", tags = [] } = req.body

      const document = await Document.create({
        title,
        content,
        author: req.user.id,
        visibility,
        tags,
      })

      // Handle mentions
      const mentions = extractMentions(content)
      if (mentions.length > 0) {
        console.log(mentions, "mentions")
       // Normalize both database names and mentions
const mentionedUsers = await User.find({
  $or: mentions.map(m => ({
    name: new RegExp(m.split(' ')[0], 'i') // Match first part only
  }))
})
// console.log(mentionedUsers, "mentioneduser")
        // Auto-share with mentioned users and create notifications
         for (const user of mentionedUsers) {
    if (user._id.toString() !== req.user.id.toString()) {
      // console.log('Processing mention for user:', user.name) // Debug
      
      document.sharedWith.push({
        user: user._id,
        permission: "view",
      })
    
      try {
        const notification = await Notification.create({
          recipient: user._id,
          sender: req.user.id,
          type: "mention",
          document: document._id,
          message: `${req.user.name} mentioned you in "${title}"`,
        })
        console.log('Notification created:', notification) // Debug
      } catch (notifErr) {
        console.error('Notification creation failed:', notifErr)
      }
    }
           }

        await document.save()
      }

      const populatedDocument = await Document.findById(document._id)
        .populate("author", "name email")
        .populate("sharedWith.user", "name email")

      res.status(201).json({
        success: true,
        document: populatedDocument,
      })
    } catch (error) {
      console.error("Create document error:", error)
      res.status(500).json({ message: "Server error" })
    }
  },
)

// @route   PUT /api/documents/:id
// @desc    Update document
// @access  Private
router.put(
  "/:id",
  protect,
  [
    body("title").optional().trim().isLength({ min: 1 }).withMessage("Title cannot be empty"),
    body("content").optional().trim().isLength({ min: 1 }).withMessage("Content cannot be empty"),
    body("visibility").optional().isIn(["public", "private"]).withMessage("Invalid visibility option"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      const { hasAccess, document } = await checkDocumentAccess(req.params.id, req.user.id, "edit")

      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" })
      }

      const { title, content, visibility, tags } = req.body
      const updateData = {}

      if (title !== undefined) updateData.title = title
      if (content !== undefined) updateData.content = content
      if (visibility !== undefined) updateData.visibility = visibility
      if (tags !== undefined) updateData.tags = tags

      // Handle new mentions if content is updated
      if (content !== undefined) {
        const mentions = extractMentions(content)
        if (mentions.length > 0) {
          // const mentionedUsers = await User.find({
          //   name: { $in: mentions },
          // })
          const mentionedUsers = await User.find({
  $or: mentions.map(m => ({
    name: new RegExp(m.split(' ')[0], 'i') // Match first part only
  }))
})
console.log(mentionedUsers,"mentionedUsers");
          for (const user of mentionedUsers) {
            if (user._id.toString() !== req.user.id.toString()) {
              // Check if user is already shared
              const alreadyShared = document.sharedWith.some((share) => share.user.toString() === user._id.toString())

              if (!alreadyShared) {
                document.sharedWith.push({
                  user: user._id,
                  permission: "view",
                })

                // Create notification
                await Notification.create({
                  recipient: user._id,
                  sender: req.user.id,
                  type: "mention",
                  document: document._id,
                  message: `${req.user.name} mentioned you in "${title || document.title}"`,
                })
              }
            }
          }
        }
      }

      Object.assign(document, updateData)
      await document.save()

      const updatedDocument = await Document.findById(document._id)
        .populate("author", "name email")
        .populate("sharedWith.user", "name email")

      res.json({
        success: true,
        document: updatedDocument,
      })
    } catch (error) {
      console.error("Update document error:", error)
      res.status(500).json({ message: "Server error" })
    }
  },
)

// @route   DELETE /api/documents/:id
// @desc    Delete document
// @access  Private
router.delete("/:id", protect, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)

    if (!document || document.isDeleted) {
      return res.status(404).json({ message: "Document not found" })
    }

    // Only author can delete
    if (document.author.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Access denied" })
    }

    document.isDeleted = true
    await document.save()

    res.json({ success: true, message: "Document deleted successfully" })
  } catch (error) {
    console.error("Delete document error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   POST /api/documents/:id/share
// @desc    Share document with user
// @access  Private
router.post(
  "/:id/share",
  protect,
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("permission").isIn(["view", "edit"]).withMessage("Permission must be view or edit"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        })
      }

      const { hasAccess, document } = await checkDocumentAccess(req.params.id, req.user.id, "edit")

      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" })
      }

      const { email, permission } = req.body

      const userToShare = await User.findOne({ email })
      if (!userToShare) {
        return res.status(404).json({ message: "User not found" })
      }

      // Check if already shared
      const existingShare = document.sharedWith.find((share) => share.user.toString() === userToShare._id.toString())

      if (existingShare) {
        existingShare.permission = permission
      } else {
        document.sharedWith.push({
          user: userToShare._id,
          permission,
        })
      }

      await document.save()

      // Create notification
      await Notification.create({
        recipient: userToShare._id,
        sender: req.user.id,
        type: "share",
        document: document._id,
        message: `${req.user.name} shared "${document.title}" with you`,
      })

      const updatedDocument = await Document.findById(document._id)
        .populate("author", "name email")
        .populate("sharedWith.user", "name email")

      res.json({
        success: true,
        document: updatedDocument,
      })
    } catch (error) {
      console.error("Share document error:", error)
      res.status(500).json({ message: "Server error" })
    }
  },
)

// @route   DELETE /api/documents/:id/share/:userId
// @desc    Remove user access from document
// @access  Private
router.delete("/:id/share/:userId", protect, async (req, res) => {
  try {
    const { hasAccess, document } = await checkDocumentAccess(req.params.id, req.user.id, "edit")

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" })
    }

    document.sharedWith = document.sharedWith.filter((share) => share.user.toString() !== req.params.userId)

    await document.save()

    const updatedDocument = await Document.findById(document._id)
      .populate("author", "name email")
      .populate("sharedWith.user", "name email")

    res.json({
      success: true,
      document: updatedDocument,
    })
  } catch (error) {
    console.error("Remove share error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

module.exports = router
