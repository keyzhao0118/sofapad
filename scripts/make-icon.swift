// Draws SofaPad's softly raised grayscale app icon and its menu-bar template.
// Run via scripts/make-icon.sh; no external assets or drawing dependencies.
import AppKit

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
let variants: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

func gray(_ value: CGFloat, alpha: CGFloat = 1) -> CGColor { CGColor(gray: value, alpha: alpha) }

func gradient(in context: CGContext, colors: [CGColor], locations: [CGFloat], from: CGPoint, to: CGPoint) {
    guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceGray(),
                                    colors: colors as CFArray, locations: locations) else { return }
    context.drawLinearGradient(gradient, start: from, end: to,
                               options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

func edge(in context: CGContext, rect: CGRect, radius: CGFloat, width: CGFloat,
          top: CGColor, bottom: CGColor) {
    context.saveGState()
    let inner = rect.insetBy(dx: width / 2, dy: width / 2)
    context.addPath(CGPath(roundedRect: inner, cornerWidth: radius - width / 2,
                           cornerHeight: radius - width / 2, transform: nil))
    context.setLineWidth(width)
    context.replacePathWithStrokedPath(); context.clip()
    gradient(in: context, colors: [top, bottom], locations: [0, 1],
             from: CGPoint(x: rect.minX, y: rect.maxY), to: CGPoint(x: rect.maxX, y: rect.minY))
    context.restoreGState()
}

func drawMark(in context: CGContext, rect: CGRect, template: Bool) {
    let radius = rect.height * 0.16
    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    if template {
        context.setFillColor(gray(0)); context.addPath(path); context.fillPath()
    } else {
        // The mark retains its silhouette; a soft contact shadow lifts it off the tile.
        context.saveGState()
        context.setShadow(offset: CGSize(width: 0, height: -rect.height * 0.012),
                          blur: rect.height * 0.022, color: gray(0, alpha: 0.20))
        context.setFillColor(gray(0.43)); context.addPath(path); context.fillPath()
        context.restoreGState()
        context.saveGState(); context.addPath(path); context.clip()
        gradient(in: context, colors: [gray(0.53), gray(0.43), gray(0.38)], locations: [0, 0.6, 1],
                 from: CGPoint(x: rect.minX, y: rect.maxY), to: CGPoint(x: rect.maxX, y: rect.minY))
        context.restoreGState()
        edge(in: context, rect: rect, radius: radius, width: max(0.5, rect.width * 0.0025),
             top: gray(1, alpha: 0.32), bottom: gray(0, alpha: 0.14))
    }
    // One solid surface with a pointer cutout, optically centred inside it.
    let arrow: [CGPoint] = [
        CGPoint(x: 0.337, y: 0.83), CGPoint(x: 0.337, y: 0.17),
        CGPoint(x: 0.475, y: 0.355), CGPoint(x: 0.544, y: 0.17),
        CGPoint(x: 0.613, y: 0.21), CGPoint(x: 0.544, y: 0.395),
        CGPoint(x: 0.691, y: 0.395),
    ]
    context.saveGState()
    if template { context.setBlendMode(.clear) }
    context.setFillColor(gray(0.98))
    context.beginPath()
    for (index, point) in arrow.enumerated() {
        let position = CGPoint(x: rect.minX + point.x * rect.width, y: rect.minY + point.y * rect.height)
        if index == 0 { context.move(to: position) } else { context.addLine(to: position) }
    }
    context.closePath(); context.fillPath()
    context.restoreGState()
}

func draw(in context: CGContext, size: CGFloat, template: Bool) {
    context.setAllowsAntialiasing(true)
    if template {
        drawMark(in: context, rect: CGRect(x: size / 18, y: size * 3 / 18, width: size * 16 / 18, height: size * 12 / 18), template: true)
        return
    }
    let inset = size * 0.055
    let body = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = body.width * 0.2237
    let path = CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil)
    // A shallow lower rim and a broad shadow suggest depth without a heavy outline.
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -size * 0.018),
                      blur: size * 0.025, color: gray(0, alpha: 0.18))
    let base = body.offsetBy(dx: 0, dy: -size * 0.010)
    context.setFillColor(gray(0.80))
    context.addPath(CGPath(roundedRect: base, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.fillPath(); context.restoreGState()
    context.saveGState(); context.addPath(path); context.clip()
    gradient(in: context, colors: [gray(0.995), gray(0.95), gray(0.875)], locations: [0, 0.48, 1],
             from: CGPoint(x: body.minX + body.width * 0.12, y: body.maxY),
             to: CGPoint(x: body.maxX, y: body.minY))
    context.restoreGState()
    edge(in: context, rect: body, radius: radius, width: max(0.6, size * 0.002),
         top: gray(1, alpha: 0.90), bottom: gray(0.64, alpha: 0.25))
    drawMark(in: context, rect: CGRect(x: size * 0.205, y: size * 0.28, width: size * 0.59, height: size * 0.44), template: false)
}

func render(_ pixels: Int, template: Bool = false) throws -> Data {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let graphics = NSGraphicsContext(bitmapImageRep: rep) else { throw CocoaError(.fileWriteUnknown) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    draw(in: graphics.cgContext, size: CGFloat(pixels), template: template)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = rep.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
    return data
}

try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for (name, pixels) in variants {
    try render(pixels).write(to: URL(fileURLWithPath: output + "/" + name + ".png"))
}
let menuOutput = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "MacApp"
try render(18, template: true).write(to: URL(fileURLWithPath: menuOutput + "/MenuBarIcon.png"))
try render(36, template: true).write(to: URL(fileURLWithPath: menuOutput + "/MenuBarIcon@2x.png"))
print("Wrote \(variants.count) app icon sizes and two menu-bar template sizes")
