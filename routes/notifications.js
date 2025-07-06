const express = require("express")
const Notification = require("../models/Notification")
const { protect } = require("../middleware/auth")

const router = express.Router()

// @route   GET /api/notifications
// @desc    Get user notifications
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, since } = req.query

    // Build query
    const query = { recipient: req.user.id }

    // If 'since' parameter is provided, only get notifications after that timestamp
    if (since) {
      query.createdAt = { $gt: new Date(since) }
    }

    const notifications = await Notification.find(query)
      .populate("sender", "name email")
      .populate("document", "title")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    })

    // Get latest notification timestamp for polling
    const latestNotification = await Notification.findOne({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .select("createdAt")

    res.json({
      success: true,
      notifications,
      unreadCount,
      latestTimestamp: latestNotification?.createdAt || new Date(),
      hasMore: notifications.length === limit,
    })
  } catch (error) {
    console.error("Get notifications error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   GET /api/notifications/check
// @desc    Check for new notifications (lightweight endpoint for polling)
// @access  Private
router.get("/check", protect, async (req, res) => {
  try {
    const { since } = req.query

    const query = {
      recipient: req.user.id,
      ...(since && { createdAt: { $gt: new Date(since) } }),
    }

    const newNotificationsCount = await Notification.countDocuments(query)
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    })

    const latestNotification = await Notification.findOne({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .select("createdAt")

    res.json({
      success: true,
      hasNewNotifications: newNotificationsCount > 0,
      newCount: newNotificationsCount,
      unreadCount,
      latestTimestamp: latestNotification?.createdAt || new Date(),
    })
  } catch (error) {
    console.error("Check notifications error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user.id,
    })

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" })
    }

    notification.isRead = true
    await notification.save()

    res.json({
      success: true,
      notification,
    })
  } catch (error) {
    console.error("Mark notification read error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put("/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true })

    res.json({
      success: true,
      message: "All notifications marked as read",
    })
  } catch (error) {
    console.error("Mark all notifications read error:", error)
    res.status(500).json({ message: "Server error" })
  }
})

module.exports = router
