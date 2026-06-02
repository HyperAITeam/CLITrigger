import nodePath from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';

// Opens an OS-native "open file" dialog on the SERVER host and returns the
// chosen absolute path (forward-slash normalized), or null if cancelled.
//
// This mirrors the folder picker in routes/projects.ts (POST /browse) but
// selects a FILE instead of a folder, so it works the same in the browser
// and the Electron app — the dialog appears on the machine running the
// server, which for this local tool is the user's machine.
export function pickFile(initialDir = '', title = 'Select a file'): string | null {
  try {
    let selected = '';

    if (process.platform === 'win32') {
      const initialEscaped = initialDir.replace(/'/g, "''");
      const titleEscaped = title.replace(/'/g, "''");
      // Same IFileDialog COM wrapper as the folder picker, minus FOS_PICKFOLDERS
      // so it selects a file.
      const csharpSrc = `using System;
using System.Runtime.InteropServices;

namespace CLITriggerFilePicker {
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialogClass { }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog {
        [PreserveSig] uint Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, uint fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    public static class Picker {
        const uint FOS_FORCEFILESYSTEM = 0x40;
        const uint FOS_NOCHANGEDIR = 0x8;
        const uint FOS_FILEMUSTEXIST = 0x1000;
        const uint SIGDN_FILESYSPATH = 0x80058000;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = true)]
        static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        public static string Pick(string initialDir, string title) {
            var dialog = (IFileDialog)new FileOpenDialogClass();
            dialog.SetOptions(FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_FILEMUSTEXIST);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);

            if (!string.IsNullOrEmpty(initialDir)) {
                try {
                    Guid iid = typeof(IShellItem).GUID;
                    IShellItem startItem;
                    int hr = SHCreateItemFromParsingName(initialDir, IntPtr.Zero, ref iid, out startItem);
                    if (hr == 0 && startItem != null) dialog.SetFolder(startItem);
                } catch { }
            }

            uint showRes = dialog.Show(IntPtr.Zero);
            if (showRes != 0) return "";

            IShellItem result;
            dialog.GetResult(out result);
            IntPtr pszPath;
            result.GetDisplayName(SIGDN_FILESYSPATH, out pszPath);
            string path = Marshal.PtrToStringUni(pszPath);
            Marshal.FreeCoTaskMem(pszPath);
            return path;
        }
    }
}`;

      const scriptLines = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        "Add-Type -TypeDefinition @'",
        csharpSrc,
        "'@",
        `$picked = [CLITriggerFilePicker.Picker]::Pick('${initialEscaped}', '${titleEscaped}')`,
        'if ($picked) { Write-Output $picked }',
      ];

      const tmpScript = nodePath.join(os.tmpdir(), `clitrigger-filepick-${Date.now()}.ps1`);
      // UTF-8 BOM so PowerShell 5.1 reads non-ASCII (e.g. Korean) chars correctly
      fs.writeFileSync(tmpScript, '﻿' + scriptLines.join('\r\n'), 'utf-8');
      try {
        selected = execFileSync('powershell', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmpScript], {
          encoding: 'utf-8',
          timeout: 120000,
          windowsHide: false,
        }).replace(/^﻿/, '').trim();
      } finally {
        try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
      }
    } else if (process.platform === 'darwin') {
      const escapeAS = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const prompt = `with prompt "${escapeAS(title)}"`;
      const script = initialDir
        ? `POSIX path of (choose file ${prompt} default location (POSIX file "${escapeAS(initialDir)}"))`
        : `POSIX path of (choose file ${prompt})`;
      selected = execFileSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: 120000 }).trim();
    } else {
      // Linux: zenity, then kdialog
      const args = ['--file-selection', `--title=${title}`];
      if (initialDir) args.push(`--filename=${initialDir}/`);
      try {
        selected = execFileSync('zenity', args, { encoding: 'utf-8', timeout: 120000 }).trim();
      } catch {
        selected = execFileSync('kdialog', ['--getopenfilename', initialDir || os.homedir()], {
          encoding: 'utf-8',
          timeout: 120000,
        }).trim();
      }
    }

    return selected ? selected.replace(/\\/g, '/') : null;
  } catch {
    // User cancelled or no dialog tool available
    return null;
  }
}
