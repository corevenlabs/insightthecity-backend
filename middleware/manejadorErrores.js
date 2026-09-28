const manejadorErrors = (err, req, res, next) => {
    console.error(err)
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 500
    return res.status(status).json({
        success: false,
        message: err.message
    })
}

module.exports = manejadorErrors
