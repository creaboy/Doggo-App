// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
              .pin { width: 22px; height: 22px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.4); box-sizing: border-box; cursor: pointer; }
              .dogpin { width: 32px; height: 32px; border-radius: 50%; background: #fff; border: 3px solid #999; box-shadow: 0 2px 6px rgba(0,0,0,0.4); box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #374151; }
              .dogpin svg { width: 19px; height: 19px; fill: currentColor; display: block; }
              .wpin { min-width: 26px; height: 26px; padding: 0 5px; border-radius: 13px; background: #fff; color: #1f2937; border: 3px solid #2D6AE8; box-shadow: 0 2px 6px rgba(0,0,0,0.4); box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; font: 700 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
              .cluster { min-width: 28px; height: 28px; padding: 0 7px; border-radius: 14px; background: #2D6AE8; color: #fff; font: 700 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.45); box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; }
              .userdot { width: 20px; height: 20px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,0.4); box-sizing: border-box; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
