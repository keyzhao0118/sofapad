// Draws the SofaPad app icon into an .iconset folder. Run via scripts/make-icon.sh.
import AppKit

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
let variants: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

func draw(in context: CGContext, size: CGFloat) {
    let inset = size * 0.055
    let body = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = body.width * 0.2237
    context.saveGState()
    context.addPath(CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.clip()
    let space = CGColorSpaceCreateDeviceRGB()
    let colors = [CGColor(srgbRed: 0.35, green: 0.48, blue: 0.32, alpha: 1),
                  CGColor(srgbRed: 0.14, green: 0.22, blue: 0.14, alpha: 1)] as CFArray
    if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
        context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0), options: [])
    }
    // Trackpad
    let pad = CGRect(x: size * 0.21, y: size * 0.13, width: size * 0.58, height: size * 0.40)
    context.addPath(CGPath(roundedRect: pad, cornerWidth: size * 0.055, cornerHeight: size * 0.055, transform: nil))
    context.setStrokeColor(CGColor(srgbRed: 0.94, green: 0.94, blue: 0.88, alpha: 0.55))
    context.setLineWidth(size * 0.028)
    context.strokePath()
    // Pointer, the classic macOS arrow, sitting on the trackpad
    let arrow: [CGPoint] = [CGPoint(x: 0.00, y: 1.00), CGPoint(x: 0.00, y: 0.00), CGPoint(x: 0.28, y: 0.28),
                            CGPoint(x: 0.42, y: 0.00), CGPoint(x: 0.56, y: 0.06), CGPoint(x: 0.42, y: 0.34),
                            CGPoint(x: 0.72, y: 0.34)]
    let height = size * 0.40, scale = height
    context.beginPath()
    for (index, point) in arrow.enumerated() {
        let moved = CGPoint(x: size * 0.33 + point.x * scale, y: size * 0.28 + point.y * scale)
        if index == 0 { context.move(to: moved) } else { context.addLine(to: moved) }
    }
    context.closePath()
    context.setFillColor(CGColor(srgbRed: 0.96, green: 0.95, blue: 0.89, alpha: 1))
    context.fillPath()
    context.restoreGState()
}

func render(_ pixels: Int) -> Data? {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let graphics = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    draw(in: graphics.cgContext, size: CGFloat(pixels))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for (name, pixels) in variants {
    guard let data = render(pixels) else { continue }
    try data.write(to: URL(fileURLWithPath: output + "/" + name + ".png"))
}
print("Wrote \(variants.count) PNGs to \(output)")
