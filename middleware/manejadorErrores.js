const manejadorErrors = (err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error(err.code || err.message);
    if (err.code === '23505') { err.status = 409; err.message = 'Este registro o pago ya está asociado a una ficha'; }
    if (err.code === 'LIMIT_FILE_SIZE') { err.status = 400; err.message = 'El archivo supera el límite permitido'; }
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 500
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'No se pudo completar la operación' : err.message
    })
}

module.exports = manejadorErrors
