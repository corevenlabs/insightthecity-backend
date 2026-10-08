const authorization = {
  en: "I authorize ITC CLUB to use the submitted information, logo and photographs to prepare and publish this business profile.",
  es: "Autorizo a ITC CLUB a usar la información, logo y fotografías enviados para preparar y publicar la ficha de este negocio.",
  pt: "Autorizo o ITC CLUB a usar as informações, logo e fotografias enviados para preparar e publicar o perfil deste negócio.",
};
const errors = {
  "El enlace venció o no es válido": [
    "This link has expired or is invalid. Contact your executive.",
    "Este link expirou ou é inválido. Entre em contato com seu executivo.",
  ],
  "El enlace venció": [
    "This link has expired. Contact your executive.",
    "Este link expirou. Entre em contato com seu executivo.",
  ],
  "El formulario no está disponible para editar": [
    "This form is not currently available for editing.",
    "Este formulário não está disponível para edição.",
  ],
  "Adjunta el logo y al menos cuatro fotografías diferentes": [
    "Add your logo and at least four different photographs.",
    "Adicione seu logo e pelo menos quatro fotografias diferentes.",
  ],
  "Acepta los términos y autoriza el uso del material": [
    "Accept the agreement and authorize use of the submitted material.",
    "Aceite o acordo e autorize o uso do material enviado.",
  ],
  "Acepta el acuerdo e indica tu nombre": [
    "Accept the agreement and enter your full name.",
    "Aceite o acordo e informe seu nome completo.",
  ],
  "El enlace debe ser HTTPS": [
    "Use a secure link starting with https://.",
    "Use um link seguro que comece com https://.",
  ],
  "Falta el enlace del beneficio": [
    "Enter the benefit URL.",
    "Informe a URL do benefício.",
  ],
  "Completa los límites del QR": [
    "Complete the QR availability and per-member limit.",
    "Preencha a disponibilidade de QR e o limite por membro.",
  ],
  "Límite por usuario inválido": [
    "Enter a valid positive per-member limit.",
    "Informe um limite positivo válido por membro.",
  ],
  "Cantidad total inválida": [
    "Enter a valid total quantity.",
    "Informe uma quantidade total válida.",
  ],
  "Revisa la vigencia del beneficio": [
    "The benefit end date must be after its start date.",
    "A data final deve ser posterior à data inicial.",
  ],
  "Usa PNG, JPEG o WebP": [
    "Use PNG, JPEG or WebP images.",
    "Use imagens PNG, JPEG ou WebP.",
  ],
  "Este archivo ya fue adjuntado": [
    "This image is already attached.",
    "Esta imagem já foi anexada.",
  ],
  "Elimina el logo anterior primero": [
    "Remove the current logo before uploading another.",
    "Remova o logo atual antes de enviar outro.",
  ],
  "Máximo 13 archivos y 40 MB por cliente": [
    "Maximum 13 files and 40 MB per business.",
    "Máximo de 13 arquivos e 40 MB por negócio.",
  ],
  "El archivo supera el límite permitido": [
    "Each file must be 4 MB or smaller.",
    "Cada arquivo deve ter no máximo 4 MB.",
  ],
  "No hay un pago pendiente por Stripe": [
    "There is no pending Stripe payment. Refresh the payment status.",
    "Não há pagamento Stripe pendente. Atualize o estado do pagamento.",
  ],
  "El pago está en verificación; actualiza su estado": [
    "Your payment is being verified. Check its status.",
    "Seu pagamento está sendo verificado. Consulte o estado.",
  ],
  "Espera un momento e inténtalo de nuevo": [
    "Please wait a moment and try again.",
    "Aguarde um momento e tente novamente.",
  ],
};
function localized(message, lang) {
  if (lang === "es") return message;
  const index = lang === "pt" ? 1 : 0;
  if (message.startsWith("Falta:"))
    return index
      ? "Preencha todos os campos obrigatórios."
      : "Complete all required fields.";
  return (
    errors[message]?.[index] ||
    (index
      ? "Não foi possível concluir a solicitação. Verifique os dados ou entre em contato com seu executivo."
      : "Unable to complete the request. Check your information or contact your executive.")
  );
}
module.exports = { authorization, localized };
